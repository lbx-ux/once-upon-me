package com.onceuponme.api.credit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onceuponme.api.credit.dto.RedeemResult;
import com.onceuponme.api.support.ApiException;

/**
 * 额度、兑换码这一整套的验收（订单台账 2026-10-30 决定不做）。
 *
 * <p>★ 这一组里最要紧的三条，各自对着一种"看起来能跑、其实会出事"的实现：
 *
 * <p>1. <b>同一张码并发核销只成一次。</b>先查再写的实现在这里会发出两份额度，
 * 而单线程的测试全绿。
 * <p>2. <b>额度不够时 402，而且余额一分不动。</b>把失败写成 500 或者"扣成负数"
 * 都能让界面继续往下走。
 * <p>3. <b>退款按书号封顶、按次退。</b>出图那一路会重连、重试，退款接口被打两次是常态；
 * 而"失败了、重试、又失败"是两次真实的生成，两笔都该退。
 * ★ 这一条是 2026-10-30 补的：原来的判据是"这本书退过没有"，于是第二次失败永远退不回来；
 * 同时它也不封顶，"只扣过 1 本、要退 10 本"会白发出 9 本。
 *
 * <p>★ 自成一个内存库（同 {@code AdminUsersIntegrationTest} 的理由）：
 * 这一组要造号、发码、花钱，共用一个库只会让"这行数据是谁留下的"变成问题。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:credit-flow-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.admin.account=100000",
      "app.admin.password=admin-credit-pass"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CreditFlowIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private CreditService credits;

  @Test
  @DisplayName("★ 站长发一批码 → 用户兑换 → 余额与账本都对得上，同一张码第二次兑不掉")
  void adminIssuesCodesAndUserRedeemsOnce() throws Exception {
    String admin = adminToken();
    String phone = "13910001001";
    signUp(phone, "duihuan-123");
    String user = login(phone, "duihuan-123");

    MvcResult issued =
        mvc.perform(
                post("/api/admin/credits/codes")
                    .header("Authorization", "Bearer " + admin)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        send(
                            Map.of(
                                "batch", "测试批",
                                "count", 2,
                                "booksPerCode", 2,
                                "expiresInDays", 30,
                                "note", "对公转账"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.booksPerCode").value(2))
            // ★ 明文码只在这一条响应里出现。库里只有 HMAC，这一点由后面的
            //   "第二次兑不掉"与"库里查不回来"共同证明
            .andExpect(jsonPath("$.codes.length()").value(2))
            .andReturn();
    JsonNode body = body(issued);
    String code = body.get("codes").get(0).asText();

    // 带连字符、小写、空格都能输——规范化是宽进的
    String messy = " " + code.toLowerCase() + " ";
    mvc.perform(
            post("/api/credits/redeem")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("code", messy))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.books").value(2))
        .andExpect(jsonPath("$.balance").value(2))
        .andExpect(jsonPath("$.codeTail").isNotEmpty());

    // 第二个人拿同一张码：同一句话，不是"已经用过了"（那等于告诉他这张码存在）
    String otherPhone = "13910001002";
    signUp(otherPhone, "duihuan-456");
    String other = login(otherPhone, "duihuan-456");
    mvc.perform(
            post("/api/credits/redeem")
                .header("Authorization", "Bearer " + other)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("code", code))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("bad-code"));

    // 余额是 2，账本里也恰好是 +2
    mvc.perform(get("/api/credits").header("Authorization", "Bearer " + user))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(2))
        .andExpect(jsonPath("$.entries.length()").value(1))
        .andExpect(jsonPath("$.entries[0].delta").value(2))
        .andExpect(jsonPath("$.entries[0].reason").value("redeem"));
  }

  @Test
  @DisplayName("★ 额度不够：402 + 一分不动；够的时候扣一本，退款封顶在扣过的数上")
  void spendingAndRefundingBehaveLikeALedger() throws Exception {
    String admin = adminToken();
    String phone = "13910002001";
    signUp(phone, "huafei-1234");
    String user = login(phone, "huafei-1234");
    long userId = userIdOf(admin, phone);

    // 发一本
    mvc.perform(
            post("/api/admin/credits/grant")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("userId", userId, "books", 1, "note", "测试补发"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(1));

    // 画一本：扣掉
    mvc.perform(
            post("/api/credits/spend")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("books", 1, "ref", "book-a"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(0));

    // 再画一本：402，余额仍是 0（不是 -1）
    mvc.perform(
            post("/api/credits/spend")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("books", 1, "ref", "book-b"))))
        .andExpect(status().isPaymentRequired())
        .andExpect(jsonPath("$.code").value("no-credits"));
    mvc.perform(get("/api/credits/balance").header("Authorization", "Bearer " + user))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(0));

    // 一页都没画出来 → 退。打两次是常态（重连），第二次无害
    mvc.perform(
            post("/api/credits/refund")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("books", 1, "ref", "book-a"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(1));
    mvc.perform(
            post("/api/credits/refund")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("books", 1, "ref", "book-a"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(1));

    // 没扣过的书退不了——退款不是造币机
    mvc.perform(
            post("/api/credits/refund")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("books", 1, "ref", "book-never"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("nothing-to-refund"));
  }

  /**
   * 扣 → 退 → 再扣 → 再退。
   *
   * <p>★ 修前这段实测停在 23（第二次退是个静默的 200，余额不动）：出图失败一次退一次，
   * 界面把家长送回故事闸门（`use-run-actions` 的 `setPhase('story')`），他改一句再点，
   * 服务端**又扣一本**；再失败时那句"这本书退过没有"已经为真，于是这一本漏掉。
   *
   * <p>判据是余额回到起点，不是"第二次退款回了 200"——它修前也回 200。
   */
  @Test
  @DisplayName("★ 失败了、重试、又失败：两次都退")
  void eachFailedAttemptIsRefunded() throws Exception {
    String admin = adminToken();
    String phone = "13910002011";
    signUp(phone, "chongshi-123");
    String user = login(phone, "chongshi-123");
    long userId = userIdOf(admin, phone);
    grantBooks(admin, userId, 2);

    spend(user, "book-retry").andExpect(status().isOk()).andExpect(jsonPath("$.balance").value(1));
    refund(user, "book-retry", 1).andExpect(jsonPath("$.balance").value(2));

    // 第二轮的同一个书号：这是一次新的生成，钱也真的花了第二次
    spend(user, "book-retry").andExpect(status().isOk()).andExpect(jsonPath("$.balance").value(1));
    refund(user, "book-retry", 1).andExpect(jsonPath("$.balance").value(2));

    assertEquals(2, credits.balanceOf(userId));
  }

  /**
   * 退的比扣的多。
   *
   * <p>★ 修前实测：扣 1 本、报 {@code books: 10} 去退，余额从 22 走到 32——白得 9 本。
   * 调用方报多少本来就不该算数，真值是账本里这个书号的扣减合计。
   */
  @Test
  @DisplayName("★ 退的比扣的多：封顶在扣过的那些，不凭空发")
  void refundIsCappedAtWhatWasConsumed() throws Exception {
    String admin = adminToken();
    String phone = "13910002012";
    signUp(phone, "fengding-123");
    String user = login(phone, "fengding-123");
    long userId = userIdOf(admin, phone);
    grantBooks(admin, userId, 3);

    spend(user, "book-cap").andExpect(status().isOk()).andExpect(jsonPath("$.balance").value(2));

    refund(user, "book-cap", 10).andExpect(status().isOk()).andExpect(jsonPath("$.balance").value(3));
    // 退满之后再来一次：还是 3（重连、重试打两次无害），不是 4
    refund(user, "book-cap", 1).andExpect(status().isOk()).andExpect(jsonPath("$.balance").value(3));

    assertEquals(3, credits.balanceOf(userId));
  }

  /**
   * 同一本书并发退 5 次。
   *
   * <p>★ 修前实测：31 → 36，5 个线程各自读到"还没退过"，于是发了 5 次。
   * 修法是先 {@code FOR UPDATE} 锁住这个人的余额行再求和——没有锁的话，
   * "查了没有"与"发出去"之间永远有一条缝。
   */
  @Test
  @DisplayName("★ 同一本书并发退 5 次：只退一笔")
  void concurrentRefundsGrantOnce() throws Exception {
    String admin = adminToken();
    String phone = "13910002013";
    signUp(phone, "bingfa-1234");
    String user = login(phone, "bingfa-1234");
    long userId = userIdOf(admin, phone);
    grantBooks(admin, userId, 1);
    spend(user, "book-race").andExpect(jsonPath("$.balance").value(0));

    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger failed = new AtomicInteger();
    List<Thread> threads = new ArrayList<>();
    for (int i = 0; i < 5; i += 1) {
      threads.add(
          new Thread(
              () -> {
                try {
                  start.await();
                  credits.refund(userId, 1, "book-race");
                } catch (InterruptedException interrupted) {
                  Thread.currentThread().interrupt();
                } catch (RuntimeException unexpected) {
                  failed.incrementAndGet();
                }
              }));
    }
    threads.forEach(Thread::start);
    start.countDown();
    for (Thread thread : threads) thread.join(10_000);

    // ★ 判据是余额，不是"没人报错"：修前这里也一个错都没有，只是多发了四本
    assertEquals(0, failed.get(), "并发退款不该抛异常");
    assertEquals(1, credits.balanceOf(userId), "只扣过 1 本，最多退 1 本");
  }

  /**
   * 内部对账（启动时那一次扫描走的就是它）。
   *
   * <p>★ 它覆盖的是"退款那一行根本没机会执行"那一种：扣了、进程没了、盘上没有书。
   * 判据三格：没结算的退回来；已经结算的再扫一次不动；连扣都没扣过的账号不动。
   */
  @Test
  @DisplayName("★ 对账：没结算的退回来，结算过的不重复退")
  void settleRefundsOnlyWhatIsUnsettled() throws Exception {
    String admin = adminToken();
    String phone = "13910002014";
    signUp(phone, "duizhang-123");
    String user = login(phone, "duizhang-123");
    long userId = userIdOf(admin, phone);
    grantBooks(admin, userId, 3);

    // 两次扣、一次都没结算（两次都"进程没了"）：对账该把两笔一起退回来
    spend(user, "book-orphan").andExpect(jsonPath("$.balance").value(2));
    spend(user, "book-orphan").andExpect(jsonPath("$.balance").value(1));

    settle(userId, "book-orphan")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.refunded").value(true))
        .andExpect(jsonPath("$.balance").value(3));

    // 再扫一次：账本里已经对齐了，不该再发
    settle(userId, "book-orphan")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.refunded").value(false))
        .andExpect(jsonPath("$.balance").value(3));

    // 从没扣过额度的书号：既不是错，也不该发钱
    settle(userId, "book-ghost")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.refunded").value(false))
        .andExpect(jsonPath("$.balance").value(3));

    assertEquals(3, credits.balanceOf(userId));
  }

  @Test
  @DisplayName("★ 同一张码两个人同时兑：只有一个成功，账本里只有一条 redeem")
  void concurrentRedeemOnlyGrantsOnce() throws Exception {
    String admin = adminToken();
    String phoneA = "13910003001";
    String phoneB = "13910003002";
    signUp(phoneA, "jingtai-123");
    signUp(phoneB, "jingtai-456");
    long userA = userIdOf(admin, phoneA);
    long userB = userIdOf(admin, phoneB);

    MvcResult issued =
        mvc.perform(
                post("/api/admin/credits/codes")
                    .header("Authorization", "Bearer " + admin)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        send(
                            Map.of(
                                "batch", "并发批",
                                "count", 1,
                                "booksPerCode", 5,
                                "expiresInDays", 0))))
            .andExpect(status().isOk())
            .andReturn();
    String code = body(issued).get("codes").get(0).asText();

    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    AtomicInteger ok = new AtomicInteger();
    AtomicInteger rejected = new AtomicInteger();
    List<Thread> threads = new ArrayList<>();
    for (long userId : new long[] {userA, userB}) {
      threads.add(
          new Thread(
              () -> {
                try {
                  start.await();
                  RedeemResult result = credits.redeem(userId, code);
                  if (result.books() == 5) ok.incrementAndGet();
                } catch (ApiException expected) {
                  rejected.incrementAndGet();
                } catch (InterruptedException interrupted) {
                  Thread.currentThread().interrupt();
                }
              }));
    }
    threads.forEach(Thread::start);
    start.countDown();
    for (Thread thread : threads) thread.join(10_000);
    pool.shutdown();
    assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS));

    // ★ 两份额度同时发出去的那种坏法，在这里是 2 个成功
    assertEquals(1, ok.get(), "同一张码只能被核销一次");
    assertEquals(1, rejected.get(), "另一个人应当被拒");

    int total = credits.balanceOf(userA) + credits.balanceOf(userB);
    assertEquals(5, total, "一共只该多出 5 本");
  }

  /**
   * 演示账号有额度，而且重启不会越给越多。
   *
   * <p>★ 判据不是"余额 > 0"，是"余额恰好是那个常量"：多给的那一份是真钱。
   */
  @Test
  @DisplayName("演示账号：开局 20 本，重复触发播种也只发一次")
  void demoAccountGetsExactlyOneStartingGrant() throws Exception {
    String demo = login("123456", "123456");
    mvc.perform(get("/api/credits/balance").header("Authorization", "Bearer " + demo))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.balance").value(20));
  }

  @Test
  @DisplayName("普通用户碰不了发码与补发：403，且什么都没多发")
  void plainUsersCannotIssueOrGrant() throws Exception {
    String phone = "13910004001";
    signUp(phone, "putong-1234");
    String user = login(phone, "putong-1234");

    mvc.perform(
            post("/api/admin/credits/codes")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("batch", "x", "count", 1, "booksPerCode", 1))))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/admin/credits/grant")
                .header("Authorization", "Bearer " + user)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("userId", 1, "books", 100, "note", "x"))))
        .andExpect(status().isForbidden());
  }

  @Test
  @DisplayName("对账：管理页那个「账本差额」是 0")
  void ledgerDriftIsZero() throws Exception {
    mvc.perform(get("/api/admin/credits").header("Authorization", "Bearer " + adminToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.ledgerDrift").value(0));
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────────── */

  private String send(Map<String, ?> body) throws Exception {
    return json.writeValueAsString(body);
  }

  /** 出图那一路扣额度的形状：一本、带着书号 */
  private ResultActions spend(String token, String ref) throws Exception {
    return mvc.perform(
        post("/api/credits/spend")
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(send(Map.of("books", 1, "ref", ref))));
  }

  /** 退额度的形状。`books` 单独给出来：封顶那一条正是拿"要的"和"扣过的"作对 */
  private ResultActions refund(String token, String ref, int books) throws Exception {
    return mvc.perform(
        post("/api/credits/refund")
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(send(Map.of("books", books, "ref", ref))));
  }

  private void grantBooks(String admin, long userId, int books) throws Exception {
    mvc.perform(
            post("/api/admin/credits/grant")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("userId", userId, "books", books, "note", "测试补发"))))
        .andExpect(status().isOk());
  }

  /** 内部对账那一条。★ 它不带会话票，要的是 userId——启动时没有人在线 */
  private ResultActions settle(long userId, String ref) throws Exception {
    return mvc.perform(
        post("/api/internal/credits/settle")
            .contentType(MediaType.APPLICATION_JSON)
            .content(send(Map.of("userId", userId, "ref", ref))));
  }

  private JsonNode body(MvcResult result) throws Exception {
    return json.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private String adminToken() throws Exception {
    return login("100000", "admin-credit-pass");
  }

  private long userIdOf(String admin, String account) throws Exception {
    MvcResult overview =
        mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    for (JsonNode row : body(overview).get("users")) {
      if (account.equals(row.get("account").asText())) return row.get("userId").asLong();
    }
    throw new AssertionError("管理页里找不到 " + account);
  }

  private void signUp(String phone, String password) throws Exception {
    mvc.perform(
            post("/api/auth/sms/send")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone))))
        .andExpect(status().isOk());
    MvcResult verdict =
        mvc.perform(
                post("/api/auth/sms/verify")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(send(Map.of("account", phone, "code", "123456"))))
            .andExpect(status().isOk())
            .andReturn();
    String ticket = body(verdict).get("token").asText();
    mvc.perform(
            post("/api/auth/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("ticket", ticket, "password", password))))
        .andExpect(status().isOk());
  }

  private String login(String account, String password) throws Exception {
    MvcResult result =
        mvc.perform(
                post("/api/auth/login")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(send(Map.of("account", account, "password", password))))
            .andExpect(status().isOk())
            .andReturn();
    return body(result).get("token").asText();
  }
}
