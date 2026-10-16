package com.onceuponme.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 设密码。★ 带的是 {@code ticket}（验证码通过时发的那张 5 分钟的票），
 * **不是** account：让客户端自己说"我给哪个号设密码"就是把"这个号验证过了"
 * 这件事交给客户端保证——那样任何一个人打开控制台就能给任意号码设密码。
 * 号码只能从票里读（票是我们签的）。
 */
public record SetPasswordRequest(
    @NotBlank(message = "请先用验证码验证手机号") String ticket,
    @NotBlank(message = "请填密码") String password) {}
