package com.onceuponme.api.credit.dto;

/**
 * 一个批次（同一批生成的码）。
 *
 * <p>★ 批次不是一张表，而是 {@code redeem_codes.batch} 那个字符串的分组。
 * 这样做省掉了一张"批次表"，代价是"改批次名"要改多条——而这一轮没有任何
 * 改批次名的入口，批次名就是生成时写下的那个标签。
 */
public record AdminCodeBatch(
    String batch, int booksPerCode, int count, int redeemed, String createdAt, String note) {}
