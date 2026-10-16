package com.onceuponme.api.auth.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 要验证码。★ 字段名就叫 {@code account}（不是 phone）：这一栏同时收手机号与短账号，
 * 而"它是不是手机号"由 {@code AccountRules.isPhone} 判——字段名写成 phone
 * 会让人以为这里只收手机号，然后短账号那条路会在某次重构里被顺手删掉。
 */
public record SendCodeRequest(@NotBlank(message = "请先填手机号") String account) {}
