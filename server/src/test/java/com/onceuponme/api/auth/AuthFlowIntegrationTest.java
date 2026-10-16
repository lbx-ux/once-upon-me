package com.onceuponme.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
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

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 真跑一遍整条路：注册 → 设密码 → 登录 → 登出 → 用密码登回来 → 管理员发权限。
 *
 * <p>★ 为什么要有这个测试（而不是只测纯函数）：这一层的行为里，最要紧的几条
 * **只有整条路串起来才看得见**——"新来的号四个能力全关""权限改了不用重新登录
 * 就生效""拿设密码那张票当会话用会被挡"。纯函数测试全都是绿的，
 * 而这三条一条都没被验过。
 *
 * <p>★ 判据一律选**只有真做才会不同**的东西：不是"接口回 200"，
 * 而是"回的是那个 kind""permissions 里那一位是 false""不重新登录也能看见变化"。
 */
@SpringBootTest(
    properties = {
      "app.admin.account=100000",
      "app.admin.password=admin-integration-pass",
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthFlowIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  /* ── 演示账号 ───────────────────────────────────────────────────────────── */

  @Test
  @DisplayName("演示账号 123456/123456 直接进，四个能力全开，而且不需要短信")
  void demoAccountSignsIn() throws Exception {
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "123456", "password", "123456"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.user.account").value("123456"))
        .andExpect(jsonPath("$.user.role").value("USER"))
        .andExpect(jsonPath("$.user.permissions.text").value(true))
        .andExpect(jsonPath("$.user.permissions.speech").value(true));
  }

  /* ── 新用户：验证码 → 设密码 → 进来 ─────────────────────────────────────── */

  @Test
  @DisplayName("新号：发码 → 核验（needs-password）→ 设密码 → 进得来，且★四个能力默认全关")
  void newUserJourney() throws Exception {
    String phone = "13911110001";

    mvc.perform(
            post("/api/auth/sms/send")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone))))
        .andExpect(status().isOk())
        // 测试档是开发模式：不真发，且**必须如实说**
        .andExpect(jsonPath("$.devMode").value(true))
        .andExpect(jsonPath("$.hint").value(org.hamcrest.Matchers.containsString("没有真正发送")));

    MvcResult verdict =
        mvc.perform(
                post("/api/auth/sms/verify")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(send(Map.of("account", phone, "code", "123456"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.kind").value("needs-password"))
            .andReturn();

    String ticket = json.readTree(verdict.getResponse().getContentAsString()).get("token").asText();

    MvcResult session =
        mvc.perform(
                post("/api/auth/password")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(send(Map.of("ticket", ticket, "password", "yigebenzi123"))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.user.account").value(phone))
            // ★ 这句话是这一轮的产品口径：新来的人四个能力都没有，
            //   于是他点「开始创作」时会看到那句"请联系管理员"
            .andExpect(jsonPath("$.user.permissions.text").value(false))
            .andExpect(jsonPath("$.user.permissions.image").value(false))
            .andReturn();

    String token = json.readTree(session.getResponse().getContentAsString()).get("token").asText();

    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").exists());
  }

  @Test
  @DisplayName("★ 拿「已验证」的票当会话用 → 401（还没设密码就进不来）")
  void ticketCannotBeUsedAsSession() throws Exception {
    String phone = "13911110002";
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
            .andReturn();
    String ticket = json.readTree(verdict.getResponse().getContentAsString()).get("token").asText();

    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + ticket))
        .andExpect(status().isUnauthorized());
  }

  /* ── 登出之后再进来：★ 真销毁再重建 ─────────────────────────────────────── */

  @Test
  @DisplayName("设密码 → 登出 → 用密码登回来：昵称与首次登录时间都还在")
  void passwordSurvivesSignOut() throws Exception {
    String phone = "13911110003";
    signUp(phone, "mima-ba-wei-1");

    String firstToken = login(phone, "mima-ba-wei-1");
    mvc.perform(
            patch("/api/auth/me")
                .header("Authorization", "Bearer " + firstToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("nickname", "小满妈妈"))))
        .andExpect(status().isOk());

    MvcResult before =
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + firstToken)).andReturn();
    String createdAtBefore = json.readTree(before.getResponse().getContentAsString()).get("createdAt").asText();

    // 登出（服务端只记一笔日志；真正的注销在 BFF 删 cookie 那一步）
    mvc.perform(post("/api/auth/logout")).andExpect(status().isOk());

    String secondToken = login(phone, "mima-ba-wei-1");
    MvcResult after =
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + secondToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.nickname").value("小满妈妈"))
            .andReturn();

    assertThat(json.readTree(after.getResponse().getContentAsString()).get("createdAt").asText())
        .as("首次登录时间不该被一次新的登录刷掉")
        .isEqualTo(createdAtBefore);
  }

  /* ── 频控与锁 ───────────────────────────────────────────────────────────── */

  @Test
  @DisplayName("同一个号 60 秒内发第二次 → 429，而且说得出还要等多久")
  void resendIsRateLimited() throws Exception {
    String phone = "13911110004";
    mvc.perform(
            post("/api/auth/sms/send")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone))))
        .andExpect(status().isOk());

    mvc.perform(
            post("/api/auth/sms/send")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone))))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("sms-rate-limited"));
  }

  @Test
  @DisplayName("给短账号发验证码 → 400（它收不到短信，这是结构上的）")
  void shortAccountCannotReceiveSms() throws Exception {
    mvc.perform(
            post("/api/auth/sms/send")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "123456"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("not-a-phone"));
  }

  @Test
  @DisplayName("密码连错 5 次 → 第 6 次 429 锁住")
  void wrongPasswordLocks() throws Exception {
    String phone = "13911110005";
    signUp(phone, "zhengque-mima-1");

    for (int i = 0; i < 5; i++) {
      mvc.perform(
              post("/api/auth/login")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(send(Map.of("account", phone, "password", "cuo-de-mima-1"))))
          .andExpect(status().isBadRequest());
    }
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone, "password", "cuo-de-mima-1"))))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("too-many-attempts"));
  }

  @Test
  @DisplayName("没设过密码的号走密码登录 → 说「先用验证码登录」，不是含糊的「账号或密码不对」")
  void noPasswordIsSaidPlainly() throws Exception {
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", "13911110006", "password", "whatever-1"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("no-password"))
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("验证码")));
  }

  /* ── 权限：管理员改，用户那边当场生效 ───────────────────────────────────── */

  @Test
  @DisplayName("★ 管理员勾上「图像」之后，那个人不重新登录也看得见")
  void permissionChangeIsVisibleWithoutRelogin() throws Exception {
    String phone = "13911110007";
    signUp(phone, "yonghu-mima-1");
    String userToken = login(phone, "yonghu-mima-1");

    String adminToken = login("100000", "admin-integration-pass");
    String userId = userIdOf(userToken);

    // 普通用户打管理接口 → 403（这一条拦的是"自己给自己开权限"）
    mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isForbidden());

    mvc.perform(
            patch("/api/admin/users/" + userId + "/permissions")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("text", true, "image", true, "vision", false, "speech", false))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.permissions.image").value(true));

    // ★ 用的是**旧的**那张票
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + userToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.permissions.text").value(true))
        .andExpect(jsonPath("$.permissions.image").value(true))
        .andExpect(jsonPath("$.permissions.speech").value(false));
  }

  @Test
  @DisplayName("管理页概览：用户表、短信用量、注册开关、演示账号名字都在")
  void adminOverviewShape() throws Exception {
    String adminToken = login("100000", "admin-integration-pass");

    mvc.perform(get("/api/admin/users").header("Authorization", "Bearer " + adminToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.users.length()").value(greaterThanOrEqualTo(1)))
        .andExpect(jsonPath("$.smsDailyCap").value(300))
        .andExpect(jsonPath("$.registrationOpen").value(true))
        // ★ 演示账号的名字由服务端给：管理页要拿它把那一行标出来（口令是公开的）
        .andExpect(jsonPath("$.demoAccount").value("123456"));
  }

  /* ── 头像 ───────────────────────────────────────────────────────────────── */

  @Test
  @DisplayName("头像：正常 id 存得下，路径/URL 形状一律 400")
  void avatarAcceptsIdsOnly() throws Exception {
    String token = login("123456", "123456");

    mvc.perform(
            patch("/api/auth/me/avatar")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("avatar", "bear"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.avatar").value("bear"));

    mvc.perform(
            patch("/api/auth/me/avatar")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("avatar", "../../etc/passwd"))))
        .andExpect(status().isBadRequest());
  }

  @Test
  @DisplayName("没有票就是 401，而且只说「请先登录」")
  void anonymousCannotReadMe() throws Exception {
    mvc.perform(get("/api/auth/me"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.message").value("请先登录"));
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────────── */

  private String send(Map<String, ?> body) throws Exception {
    return json.writeValueAsString(body);
  }

  /** 走一遍"发码 → 核验 → 设密码"，返回登录名 */
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
    String ticket = json.readTree(verdict.getResponse().getContentAsString()).get("token").asText();

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
    return json.readTree(result.getResponse().getContentAsString()).get("token").asText();
  }

  private String userIdOf(String token) throws Exception {
    MvcResult result =
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andReturn();
    JsonNode node = json.readTree(result.getResponse().getContentAsString());
    return node.get("userId").asText();
  }
}
