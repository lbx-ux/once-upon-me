package com.onceuponme.api.auth;

import org.springframework.stereotype.Component;

import com.onceuponme.api.support.ApiException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 从请求里读出"现在是谁"。★ 一个地方读、一个地方判——
 * 写在各个 Controller 里的话，每个新增接口都要再抄一遍"怎么取 header、
 * 没有怎么办"，而漏掉那一次的症状是**一个不需要登录的接口**（它不报错，它只是不设防）。
 *
 * <p>★ 令牌走 {@code Authorization: Bearer <token>}，不自己发明一个 header：
 * BFF 那边把 httpOnly cookie 里的值放进这个头，是标准做法，
 * 而自定义 header 的名字会在"以后想加一层网关/反代"时变成一个要单独配的东西。
 *
 * <p>★ 只有 Java 认这个头，浏览器**看不到** cookie 里的原值（httpOnly），
 * 所以这一段链路里没有"前端拿着 token 到处走"这件事。
 */
@Component
public class CurrentSession {

  private static final String PREFIX = "Bearer ";

  private final JwtService jwt;

  public CurrentSession(JwtService jwt) {
    this.jwt = jwt;
  }

  /** 有会话就返回，没有就 401（带一句让界面能直接显示的话） */
  public JwtService.Session require(HttpServletRequest request) {
    String token = tokenOf(request);
    if (token == null) {
      throw ApiException.unauthorized("请先登录");
    }
    return jwt.verifySession(token);
  }

  /** 管理员。★ 权限判在**服务端**：管理页那个路由就算被人手工打开，接口也不会给他东西 */
  public JwtService.Session requireAdmin(HttpServletRequest request) {
    JwtService.Session session = require(request);
    if (!"ADMIN".equals(session.role())) {
      throw ApiException.forbidden("not-admin", "这一屏只有管理员能看");
    }
    return session;
  }

  private static String tokenOf(HttpServletRequest request) {
    String header = request.getHeader("Authorization");
    if (header == null || !header.startsWith(PREFIX)) {
      return null;
    }
    String token = header.substring(PREFIX.length()).trim();
    return token.isEmpty() ? null : token;
  }
}
