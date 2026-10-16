package com.onceuponme.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 改密码。
 *
 * <p>★ **要现在的密码**：只要拿着会话就能改的话，一个被借走的 cookie 就等于账号本身。
 * 这一条也顺势把"有会话"与"是本人"分开了（与设密码那条路同一个思路，只是那边靠的是
 * 一张一次性票，这边靠的是旧口令）。
 */
public record ChangePasswordRequest(
    @NotBlank(message = "请输入现在的密码") String currentPassword,
    @NotBlank(message = "请输入新密码") String newPassword) {}
