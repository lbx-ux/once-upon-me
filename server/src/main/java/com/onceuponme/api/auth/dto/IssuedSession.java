package com.onceuponme.api.auth.dto;

/**
 * 登录完成：一张会话票 + 这个人现在是什么样。
 *
 * <p>★ 两个一起给，是因为界面在两处都要用：票写进 cookie（BFF 干这件事），
 * user 立刻渲染侧栏那一格。分成两个请求的话，登录成功到侧栏改名之间会有一次闪烁。
 */
public record IssuedSession(String token, UserView user) {}
