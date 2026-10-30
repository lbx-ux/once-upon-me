package com.onceuponme.api.credit.dto;

import java.util.List;

/**
 * 管理页「额度与兑换码」那一张卡要的全部数。
 *
 * <p>★ {@code ledgerDrift} 是**对账数**：账本里 {@code SUM(delta)} 减去余额表里
 * {@code SUM(balance)}。正常情况下它恒为 0；不是 0 就说明有一次写入没走完
 * （或者有人手工改过库）——这一格红了比"余额看起来对"有用得多。
 *
 * <p>★ 两边的 SUM 都在 Java 里算（读全表再求和），没有写聚合 SQL：
 * 这一轮的规模是几百行，而 {@code SUM} 写进 Mapper 就多一处"改字段名时忘了改它"
 * 的地方。到几千行时再换，判据与 `rag/corpus.ts` 那条"现场扫"相同。
 *
 * <p>★ 2026-10-30 去掉「对公订单」那一组（`ordersTotal` / `amountCentsTotal` / `orders`）：
 * 这一版不要订单台账了。额度只从兑换码与站长补发进来，站外那笔钱不再在系统里留凭证。
 */
public record AdminCreditView(
    long totalBalance,
    long usersWithCredits,
    long codesTotal,
    long codesRedeemed,
    long ledgerDrift,
    List<AdminCodeBatch> batches) {}
