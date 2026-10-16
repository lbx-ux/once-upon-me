package com.onceuponme.api.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.onceuponme.api.support.ApiError;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * {@code X-Internal-Token} 那道闸：这个服务只认 BFF 一个调用方。
 *
 * <p>★ 它是**弱保险，不是防线**，这一点必须说清楚，免得下一个人以为有了它就安全了：
 * 公网那一跳是明文 HTTP，这把令牌在链路上是可见的。真正挡住陌生人的是
 * **Java 只监听回环**（{@code server.address=127.0.0.1}）与安全组，
 * 这一层拦的是"同一台机器上别的进程"与"将来某次配置手抖把 8080 暴露出去"。
 *
 * <p>★ 比的是**常量时间**（{@code MessageDigest.isEqual}），不是 {@code equals}：
 * 后者在第一个不同的字节就返回，把令牌一个字节一个字节地试出来在理论上是可行的。
 * 这条在这里属于"顺手做对"，成本为零。
 *
 * <p>★ 令牌没配时（本地那一档）整个过滤器不生效：本地开发不该为了登录一次去配一把令牌，
 * 而生产没配是启动就失败（见 {@link StartupChecks}），所以这里不存在"以为配了其实没配"。
 *
 * <p>★ {@code /api/health} 是唯一豁免的路径：冒烟测试（部署脚本、`curl`）
 * 需要一个不必带令牌就能问"你活着吗"的入口，而它回的只有一句话。
 */
@Component
@Order(1)
public class InternalTokenFilter extends OncePerRequestFilter {

  private static final Logger log = LoggerFactory.getLogger(InternalTokenFilter.class);

  private static final String HEADER = "X-Internal-Token";
  private static final String HEALTH_PATH = "/api/health";

  private final AppProperties properties;
  private final ObjectMapper objectMapper;

  public InternalTokenFilter(AppProperties properties, ObjectMapper objectMapper) {
    this.properties = properties;
    this.objectMapper = objectMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {

    String expected = properties.internalToken();
    if (expected == null || expected.isBlank()) {
      chain.doFilter(request, response);
      return;
    }
    if (HEALTH_PATH.equals(request.getRequestURI())) {
      chain.doFilter(request, response);
      return;
    }

    String actual = request.getHeader(HEADER);
    if (actual != null && MessageDigest.isEqual(bytes(actual), bytes(expected))) {
      chain.doFilter(request, response);
      return;
    }

    // ★ 令牌不对**不写 token 本身**进日志（哪怕只是前缀）：这个仓库里
    //   "密钥不进日志"是一条写在 ADR 里的承诺，而日志恰好是最容易破口的地方
    log.warn("拒绝一个没有（或带错）{} 的请求：{} {}", HEADER, request.getMethod(), request.getRequestURI());

    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write(objectMapper.writeValueAsString(
        new ApiError("bad-internal-token", "这个接口只接受站内调用")));
  }

  private static byte[] bytes(String value) {
    return value.getBytes(StandardCharsets.UTF_8);
  }
}
