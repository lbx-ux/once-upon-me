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
 * 全局每日硬顶——**最后一道，也是唯一一道真正硬的上限**。
 *
 * <p>★ 为什么它值得一个单独的类：前两层都是"按某个键"的（按号、按 IP），
 * 而键是可以换的——换号、换 IP、挂代理。真正回答"今天最多花多少"的只有这一条。
 * 站上公网、注册开放之后，它是那个数字的兜底，所以它必须被真的验一次。
 *
 * <p>★ 测试里把上限压到 3（不是 300）：验的是"第 N+1 条被挡住"这条逻辑，
 * 而不是 300 这个数。库也是单独的——这个类要数**总共**发了几条，
 * 与别的测试共用一个库就一定会被它们数进去。
 */
@SpringBootTest(
    properties = {
      "spring.datasource.url=jdbc:h2:mem:globalcap-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
      "app.sms.global-daily=3",
      // 前两层让开：这里要单独看全局那一层的脸色
      "app.sms.same-phone-hourly=1000",
      "app.sms.same-ip-hourly=1000"
    })
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SmsGlobalCapTest {

  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;

  @Test
  @DisplayName("★ 换号又换 IP 也刷不动：第 4 条被挡，消息里写明今天已经发了多少")
  void globalDailyCapHolds() throws Exception {
    for (int i = 0; i < 3; i++) {
      send("1394444000" + i, "203.0.113." + i).andExpect(status().isOk());
    }
    send("13944440099", "203.0.113.99")
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("全站")));
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
