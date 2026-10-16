package com.onceuponme.api.auth;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 请求是从哪儿来的。★ 这是频控的**键**，所以它的取法值得单写一个类说清楚。
 *
 * <p>Java 只监听回环，所有请求都来自 Nginx，{@code getRemoteAddr()} 永远是
 * {@code 127.0.0.1}——真按它限流，等于把全世界当成同一个人（第一条就撞上限）。
 * 所以依次读：
 *
 * <ol>
 *   <li>{@code X-Forwarded-For} 的**第一段**（Nginx 用 {@code $proxy_add_x_forwarded_for}
 *       写进去，左边是原始客户端）
 *   <li>{@code X-Real-IP}
 *   <li>{@code getRemoteAddr()}（本地直连 Java 调试时就是它）
 * </ol>
 *
 * <p>★ 这个值**可以被伪造**，前提是能连到 8080——而那是回环，所以这一层依赖
 * "Java 不对外"这个前提，它写在 README §五 的取舍里。正因为它是可伪造的，
 * 它才**只是三层频控里的一层**：全局每日硬顶那一条不认 IP，谁也绕不过去。
 */
public final class ClientIp {

  private ClientIp() {}

  public static String of(HttpServletRequest request) {
    String forwarded = request.getHeader("X-Forwarded-For");
    if (forwarded != null && !forwarded.isBlank()) {
      // 逗号列表里第一段是原始客户端，后面的都是沿途代理
      String first = forwarded.split(",")[0].trim();
      if (!first.isEmpty()) {
        return first;
      }
    }
    String real = request.getHeader("X-Real-IP");
    if (real != null && !real.isBlank()) {
      return real.trim();
    }
    String remote = request.getRemoteAddr();
    return remote == null ? "unknown" : remote;
  }
}
