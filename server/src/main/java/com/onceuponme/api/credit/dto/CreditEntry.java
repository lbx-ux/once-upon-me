package com.onceuponme.api.credit.dto;

/**
 * 账本里的一行（给界面看）。
 *
 * <p>★ {@code reason} 是机读的那一个（grant / redeem / consume / refund），
 * 界面上把它翻成人话；翻的那一处只在前端（`lib/credits/state.ts`），
 * 因为"这一笔该怎么说"是显示问题，不是账户服务的事。
 */
public record CreditEntry(
    String id, int delta, String reason, String ref, String note, String createdAt) {}
