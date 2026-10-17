package com.onceuponme.api.voice;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
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
 * 音色挂到账号上（工单 16，2026-10-17）。
 *
 * <p>★ 这一组的判据是「**换台设备还在**」：换一个全新的会话（= 另一台设备、
 * 另一个浏览器），读回来的还是同一个人挑的那一个。localStorage 那一版在这一条上必红
 * ——而它正是这次要修的那件事。所以判据不能选"存下来了没有"。
 *
 * <p>★ 第二条是「**当前只能有一个**」：换一个之后，前一个必须不再自称当前。
 * 只验"新的那个是当前"的话，一个**追加而不是替换**的实现照样绿，
 * 而它的症状是"同一本书两次生成用了两个声音"。
 *
 * <p>★ 第三条是「**删了当前那个 = 空着，不回落**」：回落会把"我删掉的声音"
 * 变成另一个陌生声音，而用户只是不想要那一条。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:voices-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.admin.account=100000",
      "app.admin.password=admin-voices-pass"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class VoiceIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("★ 换台设备还在：换一个全新的会话，读回来还是那个音色")
  void voiceSurvivesANewLogin() throws Exception {
    String phone = "13777770001";
    signUp(phone, "yinseqwe-123");

    String first = login(phone, "yinseqwe-123");
    mvc.perform(
            put("/api/voices/current")
                .header("Authorization", "Bearer " + first)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("voiceId", "longjielidou_v3.6", "name", "豆豆"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.current").value("longjielidou_v3.6"));

    // ★ 全新的登录 = 另一台设备（那台机器的 localStorage 里什么都没有）
    String second = login(phone, "yinseqwe-123");
    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + second))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.current").value("longjielidou_v3.6"))
        .andExpect(jsonPath("$.voices[0].voiceId").value("longjielidou_v3.6"))
        .andExpect(jsonPath("$.voices[0].name").value("豆豆"));
  }

  @Test
  @DisplayName("★ 当前只能有一个：换一个之后，前一个不再自称当前（两个都还在）")
  void onlyOneVoiceIsChosen() throws Exception {
    String phone = "13777770002";
    signUp(phone, "zhiyou-123");
    String token = login(phone, "zhiyou-123");

    choose(token, "longjielidou_v3.6", "豆豆");
    choose(token, "longanlingxi", "灵灵");

    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + token))
        .andExpect(jsonPath("$.current").value("longanlingxi"))
        // ★ 两个都还在列表里（换不等于删），但只有一个是当前。
        //   只验 `current` 的话，一个"追加、不清旧的"实现照样绿——
        //   而它的症状是同一个人的两条记录都自称当前
        .andExpect(jsonPath("$.voices.length()").value(2))
        .andExpect(jsonPath("$.voices[?(@.voiceId == 'longjielidou_v3.6')]").exists());
  }

  @Test
  @DisplayName("★ 删掉当前那个：当前空着，不悄悄回落到另一个声音")
  void forgettingTheChosenOneLeavesNothing() throws Exception {
    String phone = "13777770003";
    signUp(phone, "shandiao-123");
    String token = login(phone, "shandiao-123");

    choose(token, "longjielidou_v3.6", "豆豆");
    remember(token, "clone-a", "我的声音", "qwen-audio-x");

    // 刚记的那条自己会变成当前（"刚录完就想用它"），所以删的就是**被选中的那一条**
    mvc.perform(delete("/api/voices/clone-a").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.current").value(""))
        // ★ 另一条还在：删的是它邻居，不是整张表
        .andExpect(jsonPath("$.voices.length()").value(1))
        .andExpect(jsonPath("$.voices[0].voiceId").value("longjielidou_v3.6"));
  }

  @Test
  @DisplayName("★ 别人的音色：看不见、也删不掉")
  void voicesDoNotLeakBetweenAccounts() throws Exception {
    signUp("13777770004", "jia-12345");
    signUp("13777770005", "yi-123456");
    String a = login("13777770004", "jia-12345");
    String b = login("13777770005", "yi-123456");

    remember(a, "clone-of-a", "甲的声音", "qwen-audio-x");
    remember(b, "clone-of-b", "乙的声音", "qwen-audio-x");

    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + b))
        .andExpect(jsonPath("$.voices.length()").value(1))
        .andExpect(jsonPath("$.voices[0].voiceId").value("clone-of-b"));

    // ★ 乙拿着甲那条 id 来删：**不报错**（"删不存在的"与"删掉了"对外是同一件事，
    //   见 `VoiceService#forget`），但甲那一条必须还在
    mvc.perform(delete("/api/voices/clone-of-a").header("Authorization", "Bearer " + b))
        .andExpect(status().isOk());
    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + a))
        .andExpect(jsonPath("$.voices.length()").value(1))
        .andExpect(jsonPath("$.voices[0].voiceId").value("clone-of-a"));
  }

  @Test
  @DisplayName("取消选择：条目留着，当前变空（与删掉是两件事）")
  void unchoosingKeepsTheEntry() throws Exception {
    signUp("13777770006", "quxiao-123");
    String token = login("13777770006", "quxiao-123");

    choose(token, "longanlingxi", "灵灵");
    choose(token, "", null);

    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + token))
        .andExpect(jsonPath("$.current").value(""))
        .andExpect(jsonPath("$.voices.length()").value(1));
  }

  @Test
  @DisplayName("★ 只给 id 选一个预置音色：落下来的那一条**名字不能是空的**")
  void choosingAPresetByIdOnlyStillRecordsAName() throws Exception {
    signUp("13777770008", "yuzhi-123456");
    String token = login("13777770008", "yuzhi-123456");

    // ★ 与界面按「选它」时**逐字相同**：body 里只有 voiceId
    //   （`VoiceProvider#setVoice`，它假定服务端已经记着名字与模型）。
    //   这个假定对预置音色不成立——豆豆 / 灵灵是代码里的常量，第一次被选中才落一行。
    choose(token, "longjielidou_v3.6", null);

    // ★ 判据取「名字非空」，而且特意要求它等于 id：这不是"随便给个名字就行"，
    //   而是"空标签必须回退到那个真的东西"（前端的 `parseMyVoices` 见到空名字
    //   会整份拒绝，症状是整屏「音色列表不是我们认识的形状」，2026-10-17 实测到过）
    mvc.perform(get("/api/voices").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.current").value("longjielidou_v3.6"))
        .andExpect(jsonPath("$.voices.length()").value(1))
        .andExpect(jsonPath("$.voices[0].voiceId").value("longjielidou_v3.6"))
        .andExpect(jsonPath("$.voices[0].name").value("longjielidou_v3.6"));
  }

  @Test
  @DisplayName("没登录：401，而不是一份空列表（空列表会被读成「你没录过」）")
  void anonymousIsRefused() throws Exception {
    mvc.perform(get("/api/voices")).andExpect(status().isUnauthorized());
  }

  @Test
  @DisplayName("id 形状不对 → 400（它会被拼进 TTS 请求，也进 URL）")
  void badShapeIsRefused() throws Exception {
    signUp("13777770007", "xingzhuang-123");
    String token = login("13777770007", "xingzhuang-123");

    mvc.perform(
            put("/api/voices/current")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("voiceId", "../../etc/passwd"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("invalid-request"));
  }

  /* ── 小工具（与 `PermissionRequestIntegrationTest` 同一套）────────────────── */

  private void choose(String token, String voiceId, String name) throws Exception {
    Map<String, Object> body = new HashMap<>();
    body.put("voiceId", voiceId);
    if (name != null) body.put("name", name);
    mvc.perform(
            put("/api/voices/current")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(body)))
        .andExpect(status().isOk());
  }

  private void remember(String token, String voiceId, String name, String model) throws Exception {
    mvc.perform(
            post("/api/voices")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(send(Map.of("voiceId", voiceId, "name", name, "model", model))))
        .andExpect(status().isOk());
  }

  /**
   * 注册一个号。
   *
   * <p>★ 与 `PermissionRequestIntegrationTest` 逐字同一套（`/api/auth/sms/send` →
   * `/api/auth/sms/verify` → `/api/auth/password`）。那三步之间的票在**响应体**里
   * （`{"token": …}`），不走 cookie——这是 Java 那一侧的协议，BFF 才把它翻成 cookie。
   * 我第一版按 BFF 那套写过一次 cookie，结果整组测试的失败长得像"注册没成功"。
   */
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

  private com.fasterxml.jackson.databind.JsonNode body(MvcResult result) throws Exception {
    return json.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  /** 请求体：**字节**，而且是 UTF-8 的。理由见 `PermissionRequestIntegrationTest#send` */
  private byte[] send(Map<String, ?> body) throws Exception {
    return json.writeValueAsBytes(body);
  }
}
