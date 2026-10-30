package com.onceuponme.api.credit;

import java.time.LocalDateTime;
import java.util.List;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.credit.dto.CreditView;
import com.onceuponme.api.credit.dto.RedeemResult;
import com.onceuponme.api.credit.dto.SettleResult;
import com.onceuponme.api.credit.mapper.BookCreditMapper;
import com.onceuponme.api.credit.mapper.CreditAccountMapper;
import com.onceuponme.api.credit.mapper.RedeemCodeMapper;
import com.onceuponme.api.support.ApiException;

/**
 * 额度：查、扣、退、兑。★ 这里是"谁能花几本"的唯一一处判据。
 *
 * <p>四条贯穿全文件的决定：
 *
 * <p>1. <b>扣减是一条带条件的 UPDATE。</b>
 * {@code balance = balance - n WHERE balance >= n}，受影响行数为 0 就是"不够"。
 * 先 SUM 再 INSERT 在两个标签页同时点「就按这个画」时会双双通过，然后余额变成负数。
 *
 * <p>2. <b>账本与余额在同一个事务里写。</b>任何一半失败都整体回滚——一份"扣了钱但没有记录"
 * 的账，比扣错了还难查。
 *
 * <p>3. <b>失败的话只有一句，不区分"不存在/用过了/过期了"。</b>兑换码是钱，
 * 把三种失败分开说，等于给爆破的人一个"这张码存在"的确认器。
 *
 * <p>4. <b>退款按书号封顶、按次退。</b>同一本书可能被扣很多次（失败一次、重试一次，
 * 是两次真实的生成），所以"这本书退过没有"不是一个能用的判据——它会让第二次失败的
 * 那一次永远退不回来（2026-10-30 实测：扣、退、再扣、再退，余额停在 23 不动）。
 * 判据改成两边求和对齐：{@code 已退合计 ≤ 已扣合计}，这一次退 {@code min(要的, 差额)}。
 * 求和与写入都在锁内（先 {@code FOR UPDATE} 锁住这个人的余额行），
 * 否则并发的几次退款会各自读到"还没退过"，一起发出去（同日实测：并发 5 次退了 5 次）。
 */
@Service
public class CreditService {

  /** 一次授予的上限。★ 不是产品参数，是"手滑多打了几个零"的护栏 */
  static final int MAX_GRANT = 1000;

  /** 一次扣减的上限。这一轮一次只画一本 */
  static final int MAX_SPEND = 10;

  /** 流水那一栏最多回多少条 */
  static final int ENTRY_LIMIT = 50;

  private final CreditAccountMapper accounts;
  private final BookCreditMapper ledger;
  private final RedeemCodeMapper codes;
  private final CodeFactory codeFactory;
  private final RedeemAttemptGuard guard;

  public CreditService(
      CreditAccountMapper accounts,
      BookCreditMapper ledger,
      RedeemCodeMapper codes,
      CodeFactory codeFactory,
      RedeemAttemptGuard guard) {
    this.accounts = accounts;
    this.ledger = ledger;
    this.codes = codes;
    this.codeFactory = codeFactory;
    this.guard = guard;
  }

  /* ── 读 ─────────────────────────────────────────────────────────────── */

  /** 还剩几本。★ 缺行 = 0（与权限那一位"缺行 = 有"刻意相反，见 {@link CreditAccount}） */
  public int balanceOf(long userId) {
    CreditAccount account = accounts.selectById(userId);
    return account == null ? 0 : account.getBalance();
  }

  public CreditView view(long userId) {
    List<BookCredit> rows =
        ledger.selectList(
            Wrappers.<BookCredit>lambdaQuery()
                .eq(BookCredit::getUserId, userId)
                .orderByDesc(BookCredit::getId)
                // ★ 只回最近 50 条：这一屏是"最近发生了什么"，不是对账单。
                //   对账要的是全量 SUM，那一条在管理页上（AdminCreditService）
                .last("LIMIT " + ENTRY_LIMIT));
    return CreditView.of(balanceOf(userId), rows);
  }

  /* ── 写 ─────────────────────────────────────────────────────────────── */

  /**
   * 给这个人开一个额度户头。已经在就什么都不做。
   *
   * <p>★ 注册、建号、启动迁移都走这一条。并发下两个请求可能同时走到 insert，
   * 后到的那个撞唯一键——那不是错误，是"另一个请求先建了"，吞掉即可。
   */
  @Transactional
  public void ensureAccount(long userId, int initial, String note) {
    if (accounts.selectById(userId) != null) return;
    LocalDateTime now = Times.now();
    try {
      accounts.insert(CreditAccount.of(userId, initial, now));
      if (initial != 0) {
        ledger.insert(
            BookCredit.of(userId, initial, BookCredit.REASON_GRANT, null, note, now));
      }
    } catch (DuplicateKeyException race) {
      // 另一个请求先建了：以它为准。这里不重试、不覆盖——覆盖会把那次授予抹掉
    }
  }

  /** 授予（兑换、后台补发、演示账号）。返回授予之后的余额 */
  @Transactional
  public int grant(long userId, int books, String reason, String refNo, String note) {
    if (books <= 0 || books > MAX_GRANT) {
      throw ApiException.badRequest("bad-amount", "一次授予的本数要在 1 到 " + MAX_GRANT + " 之间");
    }
    ensureAccount(userId, 0, "开户");
    LocalDateTime now = Times.now();
    accounts.update(
        null,
        new UpdateWrapper<CreditAccount>()
            .eq("user_id", userId)
            .setSql("balance = balance + " + books)
            .set("updated_at", now));
    ledger.insert(BookCredit.of(userId, books, reason, refNo, note, now));
    return balanceOf(userId);
  }

  /**
   * 只发一次的授予。★ 演示账号用它：{@code refNo} 是"为什么发"的标记
   * （`demo` / `migration:<日期>`），账本里已经有同一个标记就不再发。
   *
   * <p>为什么需要它：启动时的授予必须幂等。直接调 {@link #grant} 的话，
   * 每重启一次演示账号就多 20 本——而这是真钱。判据落在账本上（有记录 = 发过），
   * 不在余额上：余额会因为花掉而变，用它判会重复发放。
   */
  @Transactional
  public void ensureGrantOnce(long userId, int books, String refNo, String note) {
    String ref = refNo == null ? "" : refNo.trim();
    if (ref.isEmpty()) {
      throw ApiException.badRequest("bad-ref", "一次性授予要带着一个标记");
    }
    long issued =
        ledger.selectCount(
            Wrappers.<BookCredit>lambdaQuery()
                .eq(BookCredit::getUserId, userId)
                .eq(BookCredit::getRefNo, ref));
    if (issued > 0) return;
    grant(userId, books, BookCredit.REASON_GRANT, ref, note);
  }

  /**
   * 扣一本（或几本）。不够就抛 402。
   *
   * <p>★ 扣的是**这一次生成**，不是"这一次点击"：同一个书号在盘上已经画过时，
   * 上游那条路由会在扣减之前就回 409（`book-exists`），所以重复点不会重复扣。
   * 而失败之后接着画同一本（`story.json` 还在、`book.json` 没写出来）会再扣一次——
   * 这是刻意的：上一轮的钱已经花掉了，接着画是**新一轮**的生成。
   */
  @Transactional
  public int spend(long userId, int books, String refNo) {
    if (books <= 0 || books > MAX_SPEND) {
      throw ApiException.badRequest("bad-amount", "一次扣减的本数要在 1 到 " + MAX_SPEND + " 之间");
    }
    String ref = refNo == null ? "" : refNo.trim();
    if (ref.isEmpty()) {
      throw ApiException.badRequest("bad-ref", "扣额度要带着是哪一本书");
    }
    ensureAccount(userId, 0, "开户");
    LocalDateTime now = Times.now();
    int changed =
        accounts.update(
            null,
            new UpdateWrapper<CreditAccount>()
                .eq("user_id", userId)
                .ge("balance", books)
                .setSql("balance = balance - " + books)
                .set("updated_at", now));
    if (changed == 0) {
      throw ApiException.paymentRequired(
          "no-credits",
          "这一本的额度用完了。已经做好的书还在书架里，随时能读；要再做一本，去「兑换」输入一张码。");
    }
    ledger.insert(
        BookCredit.of(userId, -books, BookCredit.REASON_CONSUME, ref, "画一本书", now));
    return balanceOf(userId);
  }

  /**
   * 退一本。★ 只在"一页都没画出来"时由出图那一路调用。
   *
   * <p>三条判据，缺一条就会出两种事之一（都实测过，见类注释第 4 条）：
   *
   * <p>1. <b>封顶在"这一本书扣过多少"上。</b>调用方要退几本不算数——退 10 本而只扣过
   * 1 本，多出来的那 9 本是凭空发的。真值来自账本里这个 {@code ref} 的扣减合计。
   * <p>2. <b>按次退，不是按书号退一次。</b>{@code 已退合计 < 已扣合计} 就还能退，
   * 差额就是上限。所以"失败一次、重试一次又失败"退回的是两笔，不是一笔。
   * <p>3. <b>求和与写入在同一个事务、同一把行锁里。</b>先 {@code FOR UPDATE} 锁住
   * 这个人的余额行，再求和。少了这一步，并发的几次退款会各自读到"还没退过"，
   * 然后一起 {@code grant}。
   *
   * <p>已经退满 → 回当前余额（重连、重试打两次无害）；一次都没扣过 → 400，
   * 那不是"退给没付钱的人"，是调用方搞错了对象。
   */
  @Transactional
  public int refund(long userId, int books, String refNo) {
    if (books <= 0 || books > MAX_SPEND) {
      throw ApiException.badRequest("bad-amount", "一次退款的本数要在 1 到 " + MAX_SPEND + " 之间");
    }
    String ref = refNo == null ? "" : refNo.trim();
    if (ref.isEmpty()) {
      throw ApiException.badRequest("bad-ref", "退款要带着是哪一本书");
    }

    LedgerSums sums = sumsLocked(userId, ref);
    if (sums.consumed() <= 0) {
      throw ApiException.badRequest("nothing-to-refund", "这一本没有扣过额度，没有可退的");
    }
    if (sums.left() <= 0) return balanceOf(userId);

    int amount = (int) Math.min(books, sums.left());
    return grant(
        userId, amount, BookCredit.REASON_REFUND, ref, "一页都没画出来，退回 " + amount + " 本");
  }

  /**
   * 对账：把这本书**所有还没结算的扣减**退回去。★ 给启动时那次扫描用，不是给用户调的。
   *
   * <p>为什么需要它：退款写在出图那个进程里（{@code catch} 与 {@code finally}），
   * 而一本要跑十几分钟到几小时——这中间服务重启（部署、OOM、systemd 拉起），
   * 那个 Promise 随进程消失，退款那一行**根本没机会执行**。账上已经 −1，盘上没有书。
   *
   * <p>它和 {@link #refund} 的差别只有两处：不知道也不问"要退几本"（{@code left} 全退——
   * 能被扫到的书，磁盘证据是"整本一页都没画出来"）；没得退时回 {@code refunded: false}
   * 而不是 400（"这本已经结算过"在扫描里是常态，不是调用方搞错了对象）。
   */
  @Transactional
  public SettleResult settle(long userId, String refNo) {
    String ref = refNo == null ? "" : refNo.trim();
    if (ref.isEmpty()) {
      throw ApiException.badRequest("bad-ref", "对账要带着是哪一本书");
    }
    LedgerSums sums = sumsLocked(userId, ref);
    if (sums.left() <= 0) return new SettleResult(false, balanceOf(userId));

    int balance =
        grant(
            userId,
            (int) sums.left(),
            BookCredit.REASON_REFUND,
            ref,
            "上一轮没跑完（一页都没画出来），对账退回 " + sums.left() + " 本");
    return new SettleResult(true, balance);
  }

  /** 这个书号的扣减合计与已退合计。★ 两个判据共用，锁在调用方那一侧先拿 */
  private LedgerSums sumsLocked(long userId, String ref) {
    // 户头不存在时先建一行：那把行锁得有行可锁
    ensureAccount(userId, 0, "开户");
    // ★ 锁在求和之前。反过来的话，两个并发退款会同时读到"已退 0"
    accounts.lockByUserId(userId);
    long consumed = -deltaSumOf(userId, BookCredit.REASON_CONSUME, ref);
    long refunded = deltaSumOf(userId, BookCredit.REASON_REFUND, ref);
    return new LedgerSums(consumed, refunded);
  }

  /** 一次扣减与已退的合计。{@code left} 是这一次最多能退多少 */
  private record LedgerSums(long consumed, long refunded) {
    long left() {
      return consumed - refunded;
    }
  }

  /** 账本里这个（人, 原因, 对象）的增减合计。★ 只给退款那两个判据用 */
  private long deltaSumOf(long userId, String reason, String ref) {
    return ledger
        .selectList(
            Wrappers.<BookCredit>lambdaQuery()
                .eq(BookCredit::getUserId, userId)
                .eq(BookCredit::getReason, reason)
                .eq(BookCredit::getRefNo, ref))
        .stream()
        .mapToLong(BookCredit::getDelta)
        .sum();
  }

  /**
   * 核销一张兑换码。★ 事务里做三件事：条件更新码、加额度、记账本。
   *
   * <p>条件更新是这里最要紧的一行：{@code WHERE redeemed_by IS NULL AND (expires_at IS NULL OR expires_at > now)}。
   * "先查再写"在两个人同时提交同一张码时会让两边都看到"还没用过"，然后发两份。
   */
  @Transactional
  public RedeemResult redeem(long userId, String rawCode) {
    guard.check(userId);

    String normalized = codeFactory.normalize(rawCode);
    if (!codeFactory.looksLikeCode(normalized)) {
      guard.recordFailure(userId);
      throw badCode();
    }
    String hash = codeFactory.hash(normalized);
    String tail = codeFactory.tailOf(normalized);
    LocalDateTime now = Times.now();

    int changed =
        codes.update(
            null,
            new UpdateWrapper<RedeemCode>()
                .eq("code_hash", hash)
                .isNull("redeemed_by")
                .and(w -> w.isNull("expires_at").or().gt("expires_at", now))
                .set("redeemed_by", userId)
                .set("redeemed_at", now));
    if (changed == 0) {
      guard.recordFailure(userId);
      throw badCode();
    }

    RedeemCode row = codes.selectById(hash);
    // 条件更新刚命中，这一行必然还在；走了这一句只可能是库在两步之间被删了一行
    if (row == null) {
      throw ApiException.notFound("code-vanished", "这张码刚刚不见了，刷新一次再试");
    }

    int balance =
        grant(userId, row.getBooks(), BookCredit.REASON_REDEEM, "code:" + tail, "兑换码 " + tail);
    guard.clear(userId);
    return new RedeemResult(row.getBooks(), balance, tail);
  }

  /**
   * 三种失败同一句话。
   *
   * <p>★ 不区分"不存在 / 已经用过 / 过期了"：分开说等于告诉爆破的人哪一张码存在。
   * 这一条与阅读器把"别人的书"和"不存在的书"都回 404 是同一条纪律。
   */
  private ApiException badCode() {
    return ApiException.badRequest(
        "bad-code", "这个兑换码用不了。已经用过的、过期的、或者抄错了一个字的，都会是这一句。");
  }
}
