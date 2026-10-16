package com.onceuponme.api.auth.dto;

/**
 * 改昵称。★ 没有 {@code @NotBlank}：空串是**合法值**，意思是"还没起过"
 * （与 {@code db/schema.sql} 里 nickname 那一列、前端 {@code ProfileHome} 的
 * placeholder 同一个口径）。给它加一个非空校验，就等于"昵称一旦起过就再也清不掉"。
 *
 * <p>长度上限由服务层用 {@code AccountRules.NICKNAME_MAX} 判，
 * 与前端输入框的 {@code maxLength} 是同一个数。
 */
public record NicknameRequest(String nickname) {}
