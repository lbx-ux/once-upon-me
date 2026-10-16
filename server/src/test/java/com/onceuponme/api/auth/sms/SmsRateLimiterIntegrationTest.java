package com.onceuponme.api.auth.sms;

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

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 频控的前两层（按号、按 IP），**用上线的真值测**。
 *
 * <p>★ 为什么要单独一个类、还单独一个库：这两层的判据是"窗口内的条数"，
 * 而条数是**共享状态**——和别的测试共用一个库，它们会互相把对方数进去。
 * 所以这个类自带一个内存库，并且把全局每日硬顶放到很高（它由
 * {@code SmsGlobalCapTest} 单独测，那边反过来把上限压到 3）。
 * 一个类测一层，是为了让"红了"这件事直接指出是哪一层坏了。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:ratelimit-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      // 前两层用真值（与 application.yml 里那几行一致），不靠测试自己放宽
      "app.sms.same-phone-hourly=3",
      "app.sms.same-ip-hourly=5",
      // 全局那一层在这个类里让开，它有自己的测试
      "app.sms.global-daily=100000",
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SmsRateLimiterIntegrationTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("同一个号 60 秒内第二次 → 429（说的还是「请等 60 秒」）")
  void samePhoneIsThrottled() throws Exception {
    send("13933330001", "198.51.100.1").andExpect(status().isOk());
    send("13933330001", "198.51.100.1")
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("60")));
  }

  @Test
  @DisplayName("同一台设备换着号发：第 6 条被挡——★ 同时证明服务端认的是 X-Forwarded-For")
  void sameIpIsThrottled() throws Exception {
    String ip = "198.51.100.9";
    for (int i = 0; i < 5; i++) {
      send("1393333001" + i, ip).andExpect(status().isOk());
    }
    // 第 6 条：号是新的（按号那层过得去），挡它的只能是按 IP 那层
    send("13933330099", ip)
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.code").value("sms-rate-limited"));
  }

  private org.springframework.test.web.servlet.ResultActions send(String account, String ip)
      throws Exception {
    return mvc.perform(
        post("/api/auth/sms/send")
            .header("X-Forwarded-For", ip)
            .contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("account", account))));
  }
}
