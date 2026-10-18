package com.onceuponme.api.admin;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import com.onceuponme.api.auth.AccountRules;
import com.onceuponme.api.auth.DemoAccount;

/**
 * 管理页的四个动作：建号 / 停号 / 删号 / 重置别人的密码（2026-10-17 用户要的）。
 *
 * <p>★ 这一组里**最要紧的一条**是「停号对一张已经发出去的票当场生效」。
 * 它才是"停用"这件事本身——其余几条（登不进来、复号能进、新号默认就有创作权）
 * 都是它的推论或者边角。判据选它是因为**只有真做才会不同**：
 * 一个只在登录时判一次的实现，前面那几条全绿，而这一条必红。
 *
 * <p>★ 自成一个内存库：这一组要造号、停号、删号，与别的用例共用一个库
 * 只会让"哪条数据是谁留下的"变成一个问题（同 {@code ChangePasswordIntegrationTest}）。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:admin-users-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.admin.account=100000",
      "app.admin.password=admin-users-pass"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminUsersIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("建号：默认就有创作权（2026-10-18 的口径：注册即全开，站长只留收回那一下）")
  void createUserIsAllowedByDefault() throws Exception {
    String admin = adminToken();
    mvc.perform(
            post("/api/admin/users")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "13900001001", "password", "xin-zhanghao-1"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.account").value("13900001001"))
        .andExpect(jsonPath("$.role").value("USER"))
        .andExpect(jsonPath("$.status").value("ACTIVE"))
        .andExpect(jsonPath("$.allowed").value(true));

    // 建出来的号真的能登录（会建一条登不进的记录是纯粹的假成功）
    login("13900001001", "xin-zhanghao-1");
  }

  @Test
  @DisplayName("建号：重名与短口令都拒掉，而且两句人话说得清是哪一个不行")
  void createUserRejectsDuplicatesAndWeakPasswords() throws Exception {
    String admin = adminToken();
    String body = send(Map.of("account", "13900001002", "password", "hao-mima-123"));
    mvc.perform(
            post("/api/admin/users")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());

    mvc.perform(
            post("/api/admin/users")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("account-taken"));

    mvc.perform(
            post("/api/admin/users")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "13900001003", "password", "duan"))))
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString(String.valueOf(AccountRules.PASSWORD_MIN))));
  }

  @Test
  @DisplayName("★ 停号：一张**已经发出去**的票当场作废，不用等他下次登录")
  void disablingKillsLiveSessionsImmediately() throws Exception {
    String admin = adminToken();
    String phone = "13900002001";
    signUp(phone, "tinghao-123");
    String userToken = login(phone, "tinghao-123");

    // 停之前这张票是好使的——不先证这一下，下面的红就分不清是"停号生效了"还是"票本来就不行"
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isOk());

    long userId = userIdOf(admin, phone);
    mvc.perform(
            patch("/api/admin/users/" + userId + "/status")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("status", "DISABLED"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DISABLED"));

    // ★ 这一条就是整件事：同一张票、一秒钟都没等，已经被拒了
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.message").value("这个账号已被停用，请联系管理员"));

    // 而且他也登不进新的：★ 回的是"密码不对"而不是"你被停用了"——
    // 后者等于向任何一个会猜账号的人确认这个号存在、而且它曾经能用
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone, "password", "tinghao-123"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("bad-password"))
        .andExpect(jsonPath("$.message").value("密码不对"));
  }

  @Test
  @DisplayName("复号之后回到正常：登得进、旧票**不**复活")
  void reEnablingLetsThemBackInWithoutResurrectingOldTickets() throws Exception {
    String admin = adminToken();
    String phone = "13900002002";
    signUp(phone, "fuhao-1234");
    String oldToken = login(phone, "fuhao-1234");
    long userId = userIdOf(admin, phone);

    setStatus(admin, userId, "DISABLED");
    setStatus(admin, userId, "ACTIVE");

    // 新的登录没问题
    login(phone, "fuhao-1234");
    // ★ 而停用之前那张票**不会**跟着复活：复号刻意不把密码代次拨回去。
    //   拨回去的话，一批本该作废的票会一起活过来——而"停过一次"这件事
    //   本身就该是永久留在那一代密码上的记号
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + oldToken))
        .andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("重置别人的密码：旧口令立刻不好使、新口令好使，而且他那些旧票一起作废")
  void adminResetPasswordRevokesEverythingOld() throws Exception {
    String admin = adminToken();
    String phone = "13900003001";
    signUp(phone, "jiu-mima-123");
    String userToken = login(phone, "jiu-mima-123");
    long userId = userIdOf(admin, phone);

    mvc.perform(
            patch("/api/admin/users/" + userId + "/password")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("password", "zhan-zhang-gei-1"))))
        .andExpect(status().isOk())
        // ★ 响应里**没有**口令：那一串是站长输进来的，服务端不回显、不生成、不记日志
        .andExpect(jsonPath("$.password").doesNotExist())
        .andExpect(jsonPath("$.passwordHash").doesNotExist());

    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone, "password", "jiu-mima-123"))))
        .andExpect(status().isBadRequest());
    login(phone, "zhan-zhang-gei-1");

    // 与"改密码"同一条另一半：他手上那张旧票作废了
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("★ 不能停/删自己：管理页是唯一能开权限的地方，一个手滑就把自己关在门外")
  void refusesToDisableOrDeleteYourself() throws Exception {
    String admin = adminToken();
    long me = userIdOf(admin, "100000");

    mvc.perform(
            patch("/api/admin/users/" + me + "/status")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("status", "DISABLED"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("self-target"));

    mvc.perform(delete("/api/admin/users/" + me).header("Authorization", "Bearer " + admin))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("self-target"));
  }

  @Test
  @DisplayName("★ 演示账号删不掉，而且那句话要说清「删了会自己长回来」——不然这是个会骗人的按钮")
  void refusesToDeleteTheDemoAccount() throws Exception {
    String admin = adminToken();
    long demo = userIdOf(admin, DemoAccount.ACCOUNT);

    mvc.perform(delete("/api/admin/users/" + demo).header("Authorization", "Bearer " + admin))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("demo-account"));

    // 它还在（拒绝就是拒绝，不是"拒绝了但已经删了"）
    login(DemoAccount.ACCOUNT, DemoAccount.PASSWORD);
  }

  @Test
  @DisplayName("删号：人没了，他再拿旧票来是一句说得清的 401（不是「请登录」）")
  void deletionMakesOldTicketsExplainThemselves() throws Exception {
    String admin = adminToken();
    String phone = "13900004001";
    signUp(phone, "shanhao-123");
    String userToken = login(phone, "shanhao-123");
    long userId = userIdOf(admin, phone);

    mvc.perform(delete("/api/admin/users/" + userId).header("Authorization", "Bearer " + admin))
        .andExpect(status().isNoContent());

    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.message").value("这个账号已经不在了，请重新登录"));

    // 那个号也没了：拿它登录只会得到"还没设过密码"（与"不存在"同一句，见 AuthService#login）
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone, "password", "shanhao-123"))))
        .andExpect(status().isBadRequest());
  }

  @Test
  @DisplayName("这些接口普通用户一个都碰不了：403，不是「静悄悄地什么都不做」")
  void plainUsersCannotTouchAnyOfIt() throws Exception {
    String phone = "13900005001";
    signUp(phone, "putong-1234");
    String token = login(phone, "putong-1234");

    mvc.perform(
            post("/api/admin/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "13900005002", "password", "biexiang-123"))))
        .andExpect(status().isForbidden());
    mvc.perform(
            patch("/api/admin/users/1/status")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("status", "DISABLED"))))
        .andExpect(status().isForbidden());
    mvc.perform(delete("/api/admin/users/1").header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
    mvc.perform(
            patch("/api/admin/users/1/password")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("password", "biexiang-123"))))
        .andExpect(status().isForbidden());
  }

  /**
   * ★ `/check` 是给 BFF 里那些「只在 Next 一侧存在」的管理资源用的闸
   * （现在是模型配置：它写的是磁盘上那份文件，Java 碰不到）。
   *
   * <p>判据是**三种人三种结果**，而不是"管理员能过"：这个端点存在的全部意义
   * 就是替别人回答"此刻他是不是管理员"，所以"普通人也能过"与"没登录也能过"
   * 才是它真正会坏掉的那两种方式——而它们都长成 200，看起来一切正常。
   */
  @Test
  @DisplayName("★ /check：管理员 200、普通人 403、没登录 401——它不能是个橡皮图章")
  void adminCheckIsARealGate() throws Exception {
    mvc.perform(get("/api/admin/check")).andExpect(status().isUnauthorized());

    String phone = "13900007001";
    signUp(phone, "putong-1234");
    String token = login(phone, "putong-1234");
    mvc.perform(get("/api/admin/check").header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());

    mvc.perform(get("/api/admin/check").header("Authorization", "Bearer " + adminToken()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.admin").value(true));
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────────── */

  private String send(Map<String, ?> body) throws Exception {
    return json.writeValueAsString(body);
  }

  private String adminToken() throws Exception {
    return login("100000", "admin-users-pass");
  }

  private void setStatus(String admin, long userId, String status) throws Exception {
    mvc.perform(
            patch("/api/admin/users/" + userId + "/status")
                .header("Authorization", "Bearer " + admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("status", status))))
        .andExpect(status().isOk());
  }

  /** 从管理页那份列表里按登录名找 userId。★ 不猜自增值：那些数取决于别处跑过什么 */
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
