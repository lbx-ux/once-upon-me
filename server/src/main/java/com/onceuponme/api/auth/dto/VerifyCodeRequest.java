package com.onceuponme.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

/** 核验验证码。 */
public record VerifyCodeRequest(
    @NotBlank(message = "请先填手机号") String account,
    @NotBlank(message = "请输入验证码") String code) {}
