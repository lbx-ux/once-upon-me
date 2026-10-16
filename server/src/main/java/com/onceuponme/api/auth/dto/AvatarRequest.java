package com.onceuponme.api.auth.dto;

/** 换默认头像。★ 只收一个 id，不收文件、不收 URL——理由写在 {@code AccountRules} 上。 */
public record AvatarRequest(String avatar) {}
