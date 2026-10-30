package com.onceuponme.api.credit.dto;

import java.util.List;

/**
 * 一批码生成完的结果。
 *
 * <p>★ {@code codes} 是**明文**，而且只在这一条响应里出现一次。界面拿到之后
 * 立刻渲染成可下载的 CSV；服务端不保留任何可以还原它们的东西（库里只有 HMAC）。
 * 这不是"前端小心一点"，是那张表里根本没有明文可查。
 *
 * <p>★ 2026-10-30 去掉 {@code orderNo} / {@code amountCents}：不再记订单。
 */
public record CodeBatchResult(
    String batch, int booksPerCode, List<String> codes, String expiresAt) {}
