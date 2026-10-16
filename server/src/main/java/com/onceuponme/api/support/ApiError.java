package com.onceuponme.api.support;

/**
 * 出错时唯一的响应体形状：{@code {"code": "...", "message": "..."}}。
 *
 * <p>★ 与 Next 那一侧的 {@code jsonError}（{@code src/app/api/...}）**逐字段一样**，
 * 这不是巧合：BFF 把 Java 的响应原样透传给浏览器，两边形状不同的话，
 * 翻译层就要开始猜"这句人话在哪个键里"。{@code code} 是给程序看的（BFF 与界面按它分支），
 * {@code message} 是**能直接读给人看的一句中文**——上层不做二次创作。
 */
public record ApiError(String code, String message) {}
