package com.onceuponme.api.credit.dto;

/**
 * 生成一批码的请求体。
 *
 * <p>★ 有效期用"天数"而不是时间戳：这是管理页上的一个数字输入框，而让浏览器
 * 去解释"哪天几点算过期"会引入一层它自己的时区。0 或空 = 不过期。
 * 服务端按 {@code Times.now()}（北京时间）加天数，全站只有一处说了算。
 *
 * <p>★ 2026-10-30 去掉 {@code amountCents} / {@code userId} / {@code externalNo}：
 * 这一版不要「对公订单」了，发码只发码，不再顺带记一张订单。
 */
public record CodeBatchSpec(
    String batch, int count, int booksPerCode, Integer expiresInDays, String note) {}
