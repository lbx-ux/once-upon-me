package com.onceuponme.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** 密码登录。★ {@code password} 上**没有**长度校验：长度是"设密码"那一步的事，
 * 而这里只比对哈希——演示账号那个 6 位口令就是靠这一条才登得进来。 */
public record LoginRequest(
    @NotBlank(message = "请先填手机号或账号") String account,
    @NotBlank(message = "请输入密码") String password) {}
