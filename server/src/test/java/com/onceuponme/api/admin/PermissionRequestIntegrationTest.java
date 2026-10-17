package com.onceuponme.api.admin;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 权限申请：用户提 → 管理端看得见是谁 → 批了就能用（2026-10-17 用户要的，
 * 替掉原来那句"发邮件到 2953997419@qq.com"）。
 *
 * <p>★ 这一组的判据是**整条闭环**，不是四个端点各通一下：提完要能在管理端列表里
 * 认出是谁、批完要能让那个人**不重新登录**就用上。四个端点分别绿而闭环不通，
 * 是完全可能的（比如批了之后写进了另一张表、或者要重登才生效）——
 * 而那正是用户会碰到的那个失败。
 *
 * <p>★ 另一条要害是「批准是**并上**不是换成」：只在"申请人已经有一半权限"时才出错，
 * 而那种人恰恰是最可能来提申请的人（他试过，发现缺一件）。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:permreq-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.admin.account=100000",
      "app.admin.password=admin-permreq-pass"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PermissionRequestIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("★ 整条闭环：提 → 管理端看得到是谁 → 批 → 他**不重新登录**就能用上")
  void requestToGrantEndToEnd() throws Exception {
    String admin = adminToken();
    String phone = "13788880001";
    signUp(phone, "shenqing-123");
    String userToken = login(phone, "shenqing-123");

    // 提之前：四个能力一个都没有，界面那句话说的就是这件事
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(jsonPath("$.permissions.image").value(false));

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask("想做一本有插画的书"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"))
        .andExpect(jsonPath("$.wants.image").value(true));

    // ★ 管理端要"清楚的看到是谁发送的请求"——这正是邮件那条路最缺的
    MvcResult listed =
        mvc.perform(get("/api/admin/requests").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    long requestId = -1;
    String note = null;
    for (var row : json.readTree(listed.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))) {
      if ("PENDING".equals(row.get("status").asText()) && phone.equals(row.get("account").asText())) {
        requestId = row.get("requestId").asLong();
        note = row.get("note").asText();
      }
    }
    org.junit.jupiter.api.Assertions.assertTrue(requestId > 0, "管理端列表里没有这个号那条申请");
    org.junit.jupiter.api.Assertions.assertEquals("想做一本有插画的书", note);

    mvc.perform(
            patch("/api/admin/requests/" + requestId)
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("approve", true))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("APPROVED"));

    // ★ 闭环的最后一格：**同一张票**、不重新登录，权限已经在身上了
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(jsonPath("$.permissions.image").value(true))
        .andExpect(jsonPath("$.permissions.text").value(true));
  }

  @Test
  @DisplayName("★ 批一条申请 = 这个人**四项全开**，而且不去动他本来就有的那些")
  void approvingGrantsAllFour() throws Exception {
    String admin = adminToken();
    String phone = "13788880002";
    signUp(phone, "yibanshi-123");
    String userToken = login(phone, "yibanshi-123");

    // 先给他「文本」——他手里已经有一件能力了
    long userId = userIdOf(admin, phone);
    mvc.perform(
            patch("/api/admin/users/" + userId + "/permissions")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("text", true, "image", false, "vision", false, "speech", false))))
        .andExpect(status().isOk());

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask(null))))
        .andExpect(status().isOk());
    long requestId = pendingRequestIdFor(admin, phone);

    mvc.perform(
            patch("/api/admin/requests/" + requestId)
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("approve", true))))
        .andExpect(status().isOk());

    // ★ 判据是**四项都开了**，尤其是他原来没有的那三项。
    //   只验"text 还在"的话，一个只把请求里那几项写进去、把其余的清掉的实现照样绿。
    // ★ 而这一条**分不出**"并上"与"换成"（申请恒为四项，两种写法结果一样）——
    //   所以它不再叫那个名字了。`decide` 里那段合并留着是为了"绝不拿走已有权限"
    //   这条不变式，不是靠这条测试守着的。
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(jsonPath("$.permissions.text").value(true))
        .andExpect(jsonPath("$.permissions.image").value(true))
        .andExpect(jsonPath("$.permissions.vision").value(true))
        .andExpect(jsonPath("$.permissions.speech").value(true));
  }

  @Test
  @DisplayName("一个人同时只有一条待处理的申请：再提一次是**改那一条**，不是又插一条")
  void resubmittingUpdatesTheSameRow() throws Exception {
    String admin = adminToken();
    String phone = "13788880003";
    signUp(phone, "chongfu-1234");
    String userToken = login(phone, "chongfu-1234");

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask("第一版"))))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask("改主意了"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.note").value("改主意了"))
        .andExpect(jsonPath("$.wants.image").value(true));

    // 管理端那一列里，这个号只出现一次
    MvcResult listed =
        mvc.perform(get("/api/admin/requests").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    int seen = 0;
    for (var row : json.readTree(listed.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))) {
      if (phone.equals(row.get("account").asText()) && "PENDING".equals(row.get("status").asText())) {
        seen++;
      }
    }
    org.junit.jupiter.api.Assertions.assertEquals(
        1, seen, "同一个人不该有两条待处理的申请——列表会失去信息量");
  }

  @Test
  @DisplayName("「我那条还在不在」：没申请过是 null（不是 404），提了就查得到")
  void mineReportsPendingState() throws Exception {
    String phone = "13788880004";
    signUp(phone, "wozhege-1234");
    String userToken = login(phone, "wozhege-1234");

    mvc.perform(get("/api/permission-requests/mine").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.request").doesNotExist());

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask(null))))
        .andExpect(status().isOk());

    mvc.perform(get("/api/permission-requests/mine").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.request.status").value("PENDING"))
        // ★ 「这一行是谁的」在用户那一半也必须答得出来。第一版这里是空串
        //   （`minePending` 把 user 传了 null），而空 account 在 `parseRequestRow`
        //   里是"这条读不出来"——于是提过申请的人会看到「你还没申请过」，
        //   然后再提一次。判据认的是**账号那三个字符**，不是"有没有这条"
        .andExpect(jsonPath("$.request.account").value(phone))
        .andExpect(jsonPath("$.request.wants.speech").value(true));
  }

  /**
   * ★ 申请**不需要勾任何东西**：只写一句说明就能提，而这一条申请要开的是**四项**。
   *
   * <p>这一条替掉的是原来那句「一样都没勾就提交 → 400 `asks-for-nothing`」。
   * 用户 2026-10-17 把口径改成了「申请的时候这些功能是一起发放的，申请的时候
   * 申请一下就行了」，于是"要不要勾、勾哪几项"这个问题在申请表里根本不存在了。
   *
   * <p>判据选的是**这一行记着要开四项**，不是"提交成功"：只验 200 的话，
   * 一个把四列全写成 `false` 的实现照样绿——而那一行到了管理页上会显示成
   * 「这次要的：一样都没要」，站长批下去等于什么都没发生。
   */
  @Test
  @DisplayName("★ 只写一句说明就能提，而这条申请要开的是四项（不用勾）")
  void applyingAsksForAllFour() throws Exception {
    String phone = "13788880005";
    signUp(phone, "kongde-1234");
    String token = login(phone, "kongde-1234");

    // 连 note 都可以不给
    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(new java.util.HashMap<String, Object>())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.wants.text").value(true))
        .andExpect(jsonPath("$.wants.image").value(true))
        .andExpect(jsonPath("$.wants.vision").value(true))
        .andExpect(jsonPath("$.wants.speech").value(true));
  }

  @Test
  @DisplayName("拒掉的那条**留着**：看不见已处理的申请，申请人会反复提、站长会反复拒")
  void rejectedRequestsStayInTheList() throws Exception {
    String admin = adminToken();
    String phone = "13788880006";
    signUp(phone, "jujue-123456");
    String userToken = login(phone, "jujue-123456");

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask("全都想要"))))
        .andExpect(status().isOk());
    long requestId = pendingRequestIdFor(admin, phone);

    mvc.perform(
            patch("/api/admin/requests/" + requestId)
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("approve", false))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("REJECTED"));

    // 还在列表里，而且没有把权限开出去
    MvcResult listed =
        mvc.perform(get("/api/admin/requests").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    boolean found = false;
    for (var row : json.readTree(listed.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))) {
      if (row.get("requestId").asLong() == requestId) {
        found = true;
        org.junit.jupiter.api.Assertions.assertEquals("REJECTED", row.get("status").asText());
      }
    }
    org.junit.jupiter.api.Assertions.assertTrue(found, "被拒的那条不该从列表里消失");
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(jsonPath("$.permissions.image").value(false));

    // 待处理的那条已经没了，所以他现在可以再提
    mvc.perform(get("/api/permission-requests/mine").header("Authorization", "Bearer " + userToken))
        .andExpect(jsonPath("$.request").doesNotExist());
  }

  @Test
  @DisplayName("同一条批两次 → 400「已经处理过了」（不是「又并了一遍」）")
  void refusesToDecideTwice() throws Exception {
    String admin = adminToken();
    String phone = "13788880007";
    signUp(phone, "liangci-12345");
    String userToken = login(phone, "liangci-12345");

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask(null))))
        .andExpect(status().isOk());
    long requestId = pendingRequestIdFor(admin, phone);

    decide(admin, requestId, true).andExpect(status().isOk());
    decide(admin, requestId, true)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("already-decided"));
  }

  @Test
  @DisplayName("普通用户：看不了别人的申请、也批不了；没登录连提都提不了")
  void plainUsersCannotSeeOrDecideOthersRequests() throws Exception {
    String phone = "13788880008";
    signUp(phone, "putong-123456");
    String token = login(phone, "putong-123456");

    mvc.perform(get("/api/admin/requests").header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
    mvc.perform(
            patch("/api/admin/requests/1")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("approve", true))))
        .andExpect(status().isForbidden());

    mvc.perform(
            post("/api/permission-requests")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask(null))))
        .andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("说明写太长 → 400，而且那句话里带着上限（不是一句「参数不合法」）")
  void refusesOverlongNote() throws Exception {
    String phone = "13788880009";
    signUp(phone, "taichang-1234");
    String token = login(phone, "taichang-1234");

    mvc.perform(
            post("/api/permission-requests")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(ask("很".repeat(501)))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("note-too-long"))
        .andExpect(jsonPath("$.message").value(containsString("500")));
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────────── */

  /**
   * 提一条申请。★ 请求体里**只剩一句说明**——四项是一起开通的（2026-10-17），
   * 申请人没有再要勾的东西。
   *
   * <p>★ `HashMap` 而不是 `Map.of`：note 可以为 null，而 `Map.of` 不许 null 值。
   */
  private Map<String, Object> ask(String note) {
    Map<String, Object> body = new HashMap<>();
    body.put("note", note);
    return body;
  }

  private org.springframework.test.web.servlet.ResultActions decide(
      String admin, long requestId, boolean approve) throws Exception {
    return mvc.perform(
        patch("/api/admin/requests/" + requestId)
            .header("Authorization", "Bearer " + admin)
            .contentType(MediaType.APPLICATION_JSON)
            .content(send(Map.of("approve", approve))));
  }

  /**
   * 找**某个账号**那条待处理的申请。
   *
   * ★ 不能取"列表里的第一条"：这一组的用例共用一个内存库（`DB_CLOSE_DELAY=-1`），
   *   而 JUnit 不保证执行次序——别条用例留下的待处理申请会挡在前面。
   *   第一版就是取第一条，于是 `requestToGrantEndToEnd` 拿到的是**另一个人的**申请，
   *   报出来是 `$[0].account` 期望 13788880001、实际 13788880002。
   *   判据要认**是谁的**，不是"排在第几"。
   */
  private long pendingRequestIdFor(String admin, String account) throws Exception {
    MvcResult listed =
        mvc.perform(get("/api/admin/requests").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    for (var row : json.readTree(listed.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))) {
      if ("PENDING".equals(row.get("status").asText()) && account.equals(row.get("account").asText())) {
        return row.get("requestId").asLong();
      }
    }
    throw new AssertionError("管理端列表里没有 " + account + " 的待处理申请");
  }

  private long userIdOf(String admin, String account) throws Exception {
    MvcResult overview =
        mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + admin))
            .andExpect(status().isOk())
            .andReturn();
    for (var row : json.readTree(overview.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).get("users")) {
      if (account.equals(row.get("account").asText())) {
        return row.get("userId").asLong();
      }
    }
    throw new AssertionError("管理页里找不到 " + account);
  }

  /**
   * 请求体：**字节**，而且是 UTF-8 的。
   *
   * <p>★ 不能用 `writeValueAsString` + `.content(String)`：那条路上 MockMvc 会按
   * **请求自己的字符编码**把字符串转成字节，而这个编码缺省是 ISO-8859-1——
   * 于是 `"想做一本有插画的书"` 出去就变成一串 `?`（2026-10-17 实测：
   * `$[0].note` 期望中文、实际 `???????????????????????????`）。
   * 那是**量具**的问题，不是应用的：浏览器 `fetch` 发的本来就是 UTF-8 字节，
   * 这里用 `writeValueAsBytes` 才是在发同一样东西。
   * ★ 反过来说，这条也顺手证明了一件事：应用那一整条路（H2、MyBatis、Jackson、
   *   响应）对中文是通的——只要进来的字节是对的，出去的就是对的。
   */
  private byte[] send(Map<String, ?> body) throws Exception {
    return json.writeValueAsBytes(body);
  }

  private String adminToken() throws Exception {
    return login("100000", "admin-permreq-pass");
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
    String ticket = json.readTree(verdict.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).get("token").asText();
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
    return json.readTree(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).get("token").asText();
  }
}
