package com.onceuponme.api.auth;

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

/**
 * 改密码。★ 这个功能有一半在"改"上，另一半在**撤销**上：
 * 一个人改密码，别处那些已经登着的会话必须失效——否则"改密码"在一半的场景里
 * （"有人知道我旧密码"）什么都没做。这里两条都测。
 *
 * <p>★ 自成一个内存库：这一组要造号、改密码、再用旧票打，与别的用例共用一个库
 * 只会让"哪条数据是谁留下的"变成一个问题。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:changepw-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.admin.account=100000",
      "app.admin.password=admin-changepw-pass"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChangePasswordIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("★ 改完之后：旧口令登不进、新口令登得进；而且**旧票当场作废**（别处的会话被踢下线）")
  void changeRevokesOlderSessions() throws Exception {
    String phone = "13766660001";
    signUp(phone, "jiu-mima-123");
    String oldToken = login(phone, "jiu-mima-123");

    // 改密码（用旧口令证明是本人）
    MvcResult changed =
        mvc.perform(
                patch("/api/auth/password")
                    .header("Authorization", "Bearer " + oldToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        send(Map.of("currentPassword", "jiu-mima-123", "newPassword", "xin-mima-456"))))
            .andExpect(status().isOk())
            .andReturn();
    String newToken =
        json.readTree(changed.getResponse().getContentAsString()).get("token").asText();

    // ★ 改密码的人自己不被踢出去（他刚证明了他是本人），拿到的是一张新票
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + newToken))
        .andExpect(status().isOk());

    // ★ 而**改之前**那张票作废了——这是"改密码"的另一半
    mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + oldToken))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.message").value("密码改过了，请重新登录"));

    // 旧口令登不进来，新口令可以
    mvc.perform(
            post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("account", phone, "password", "jiu-mima-123"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("bad-password"));
    login(phone, "xin-mima-456");
  }

  @Test
  @DisplayName("现在的密码不对 → 400，而且那句人话说得清是哪一个不对")
  void wrongCurrentPasswordIsRejected() throws Exception {
    String phone = "13766660002";
    signUp(phone, "zhengque-123");
    String token = login(phone, "zhengque-123");

    mvc.perform(
            patch("/api/auth/password")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "cuo-de-999", "newPassword", "xin-mima-456"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("bad-password"))
        .andExpect(jsonPath("$.message").value("现在的密码不对"));
  }

  @Test
  @DisplayName("新密码太短 / 与现在的一样 → 400（后者会把别处会话全踢掉却什么都没改，纯有害）")
  void rejectsWeakOrUnchangedPassword() throws Exception {
    String phone = "13766660003";
    signUp(phone, "yuanlai-123");
    String token = login(phone, "yuanlai-123");

    mvc.perform(
            patch("/api/auth/password")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "yuanlai-123", "newPassword", "duan")))
            )
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("至少 8 位")));

    mvc.perform(
            patch("/api/auth/password")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "yuanlai-123", "newPassword", "yuanlai-123"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("same-password"));
  }

  @Test
  @DisplayName("没登录就改密码 → 401（这个接口不是谁都能调的）")
  void requiresSession() throws Exception {
    mvc.perform(
            patch("/api/auth/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "a", "newPassword", "b"))))
        .andExpect(status().isUnauthorized());
  }

  /**
   * ★ 这一条是 2026-10-17 真撞出来的：`PATCH /api/auth/password` 那个 handler
   * 刚写上的时候，**跑着的那个 Java 进程还是旧的**，于是浏览器里"改密码"报
   * "程序出错，请过一段时间再试"、HTTP 500，日志里一条带完整栈的 ERROR。
   * 真相只有一句"这个地址不接受 PATCH"。
   *
   * <p>它查的是两件不同的事，所以两条都要在：① 接口存在（这一条红的时候，
   * 部署的那个进程就是旧的）；② 打错动词/打错地址回的是 4xx，不是 500——
   * 后者原本会掉进 `GlobalExceptionHandler` 那条 {@code Exception} 兜底里。
   * **500 是监控会响的那一档**，把"打错了"混进去，真出事那天就没信号了。
   */
  @Test
  @DisplayName("★ 打错动词 → 405、打错地址 → 404：都不是 500（500 那一档要留给「真的坏了」）")
  void wrongMethodAndUnknownRouteAre4xxNot500() throws Exception {
    // ① 这个动词、这个地址**是有的**（旧 jar 上这条会红——这正是当时缺的那句提示）
    mvc.perform(
            patch("/api/auth/password")
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "a", "newPassword", "b"))))
        .andExpect(status().isUnauthorized());

    // ② 同一个地址换一个没收的动词
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(
                    "/api/auth/password"))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(jsonPath("$.code").value("method-not-allowed"));

    // ③ 地址根本不存在
    mvc.perform(get("/api/auth/no-such-endpoint"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("not-found"));
  }

  @Test
  @DisplayName("★ 连错 5 次现在的密码 → 锁住：不然这就是一把不限速的密码验证器")
  void wrongCurrentPasswordIsThrottled() throws Exception {
    String phone = "13766660004";
    signUp(phone, "zhengque-456");
    String token = login(phone, "zhengque-456");

    for (int i = 0; i < 5; i++) {
      mvc.perform(
              patch("/api/auth/password")
                  .header("Authorization", "Bearer " + token)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(
                      send(Map.of("currentPassword", "cuo-de-999", "newPassword", "xin-mima-456"))))
          .andExpect(status().isBadRequest());
    }
    mvc.perform(
            patch("/api/auth/password")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("currentPassword", "cuo-de-999", "newPassword", "xin-mima-456"))))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("too-many-attempts"));
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────────── */

  private String send(Map<String, ?> body) throws Exception {
    return json.writeValueAsString(body);
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
}
