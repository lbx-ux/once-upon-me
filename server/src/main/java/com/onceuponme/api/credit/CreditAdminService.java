package com.onceuponme.api.credit;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.credit.dto.AdminCodeBatch;
import com.onceuponme.api.credit.dto.AdminCreditView;
import com.onceuponme.api.credit.dto.CodeBatchResult;
import com.onceuponme.api.credit.dto.CodeBatchSpec;
import com.onceuponme.api.credit.mapper.BookCreditMapper;
import com.onceuponme.api.credit.mapper.CreditAccountMapper;
import com.onceuponme.api.credit.mapper.RedeemCodeMapper;
import com.onceuponme.api.support.ApiException;

/**
 * 管理页那一张卡背后的事：看总账、生成一批码、给某个人补发额度。
 *
 * <p>★ 明文码只回一次。服务端不保留可以还原它们的任何东西（库里只有 HMAC 与后四位），
 * 所以这一条响应就是它们唯一的一次出现。界面必须当场给下载，而不是"回头再来看"。
 *
 * <p>★ 2026-10-30 去掉了「对公订单」：这一版不要订单台账。生成码不再和建单在同一个
 * 事务里（也就没有了那一类"码发了单没记"的失败模式），额度只从兑换码与补发进来。
 */
@Service
public class CreditAdminService {

  /** 一批最多多少张。★ 一个班 30 人 × 2 本 = 60 张，500 已经是一个县级的量 */
  static final int MAX_BATCH = 500;
  /** 一张码最多换几本 */
  static final int MAX_BOOKS_PER_CODE = 100;
  /** 有效期上限（天）。10 年足够，再长就是输入错了 */
  static final int MAX_EXPIRES_DAYS = 3650;
  /** 一个批次名最多多长 */
  static final int MAX_BATCH_NAME = 40;
  /** 备注最多多长 */
  static final int MAX_NOTE = 200;

  private final CreditAccountMapper accounts;
  private final BookCreditMapper ledger;
  private final RedeemCodeMapper codes;
  private final UserMapper users;
  private final CreditService credits;
  private final CodeFactory codeFactory;

  public CreditAdminService(
      CreditAccountMapper accounts,
      BookCreditMapper ledger,
      RedeemCodeMapper codes,
      UserMapper users,
      CreditService credits,
      CodeFactory codeFactory) {
    this.accounts = accounts;
    this.ledger = ledger;
    this.codes = codes;
    this.users = users;
    this.credits = credits;
    this.codeFactory = codeFactory;
  }

  /* ── 看总账 ─────────────────────────────────────────────────────────── */

  public AdminCreditView overview() {
    List<CreditAccount> balances = accounts.selectList(null);
    long totalBalance = balances.stream().mapToLong(CreditAccount::getBalance).sum();
    long usersWithCredits = balances.stream().filter(a -> a.getBalance() > 0).count();

    List<RedeemCode> codeRows =
        codes.selectList(Wrappers.<RedeemCode>lambdaQuery().orderByDesc(RedeemCode::getCreatedAt));
    long redeemed = codeRows.stream().filter(row -> row.getRedeemedBy() != null).count();

    // ★ 批次不是一张表，是 batch 那个字符串的分组。用 LinkedHashMap 保住"最近的在前"
    Map<String, List<RedeemCode>> grouped = new LinkedHashMap<>();
    for (RedeemCode row : codeRows) {
      grouped.computeIfAbsent(row.getBatch(), key -> new ArrayList<>()).add(row);
    }
    List<AdminCodeBatch> batches = new ArrayList<>(grouped.size());
    for (Map.Entry<String, List<RedeemCode>> entry : grouped.entrySet()) {
      List<RedeemCode> rows = entry.getValue();
      RedeemCode first = rows.get(0);
      int used = (int) rows.stream().filter(row -> row.getRedeemedBy() != null).count();
      batches.add(
          new AdminCodeBatch(
              entry.getKey(),
              first.getBooks(),
              rows.size(),
              used,
              Times.iso(first.getCreatedAt()),
              first.getNote()));
    }

    // ★ 对账：账本 SUM(delta) 与余额表 SUM(balance) 的差。正常恒为 0
    long ledgerTotal = ledger.selectList(null).stream().mapToLong(BookCredit::getDelta).sum();

    return new AdminCreditView(
        totalBalance,
        usersWithCredits,
        codeRows.size(),
        redeemed,
        ledgerTotal - totalBalance,
        List.copyOf(batches));
  }

  /* ── 生成一批码 ─────────────────────────────────────────────────────── */

  /**
   * 生成一批兑换码。
   *
   * <p>★ 2026-10-30 起不再可选地记一张"对公转账"订单：这一版不要订单台账。
   * 发码就是发码。
   */
  @Transactional
  public CodeBatchResult issue(CodeBatchSpec spec) {
    if (spec == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    int count = spec.count();
    int books = spec.booksPerCode();
    if (count < 1 || count > MAX_BATCH) {
      throw ApiException.badRequest("bad-count", "一次生成 1 到 " + MAX_BATCH + " 张");
    }
    if (books < 1 || books > MAX_BOOKS_PER_CODE) {
      throw ApiException.badRequest("bad-books", "每张码换 1 到 " + MAX_BOOKS_PER_CODE + " 本");
    }
    int days = spec.expiresInDays() == null ? 0 : spec.expiresInDays();
    if (days < 0 || days > MAX_EXPIRES_DAYS) {
      throw ApiException.badRequest("bad-expiry", "有效期要在 0 到 " + MAX_EXPIRES_DAYS + " 天之间");
    }

    LocalDateTime now = Times.now();
    String batch = normalizeBatch(spec.batch(), now);
    String note = cut(spec.note(), MAX_NOTE);
    LocalDateTime expiresAt = days == 0 ? null : now.plusDays(days);

    List<String> plain = new ArrayList<>(count);
    for (int i = 0; i < count; i++) {
      // ★ 明文由生成它的那个方法回，我们在这里当场收进列表——
      //   而不是"从库里再读一次"（库里只有 HMAC，没有明文可读）
      plain.add(codeFactory.format(insertOne(batch, books, note, expiresAt, now)));
    }
    return new CodeBatchResult(batch, books, List.copyOf(plain), Times.iso(expiresAt));
  }

  /** 生成一张并落库，返回**明文**（不含分组连字符）。撞主键就换一张重来 */
  private String insertOne(
      String batch, int books, String note, LocalDateTime expiresAt, LocalDateTime now) {
    for (int attempt = 0; attempt < 5; attempt++) {
      String code = codeFactory.newCode();
      try {
        codes.insert(
            RedeemCode.of(
                codeFactory.hash(code),
                codeFactory.tailOf(code),
                books,
                batch,
                note,
                expiresAt,
                now));
        return code;
      } catch (DuplicateKeyException collision) {
        // 16 位码撞一次的概率是 2^-80 量级；撞了换一张重来
      }
    }
    throw new IllegalStateException("连续 5 次生成兑换码都撞上了主键");
  }

  /* ── 补发 ───────────────────────────────────────────────────────────── */

  /** 给一个人补几本。★ 管理动作，走账本（reason=grant），不是直接改余额 */
  @Transactional
  public int grantTo(long userId, int books, String note, long actorId) {
    User user = users.selectById(userId);
    if (user == null) throw ApiException.notFound("user-not-found", "找不到这个账号");
    return credits.grant(
        userId, books, BookCredit.REASON_GRANT, "admin:" + actorId, cut(note, MAX_NOTE));
  }

  /* ── 内部零件 ───────────────────────────────────────────────────────── */

  private String normalizeBatch(String raw, LocalDateTime now) {
    String value = raw == null ? "" : raw.trim();
    if (value.isEmpty()) {
      value = "批次 " + now.format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmm"));
    }
    if (value.length() > MAX_BATCH_NAME) {
      throw ApiException.badRequest("bad-batch", "批次名最多 " + MAX_BATCH_NAME + " 个字");
    }
    return value;
  }

  private String cut(String raw, int max) {
    String value = raw == null ? "" : raw.trim();
    return value.length() <= max ? value : value.substring(0, max);
  }
}
