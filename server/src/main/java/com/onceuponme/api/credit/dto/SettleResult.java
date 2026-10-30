package com.onceuponme.api.credit.dto;

/**
 * 对账回的一行：这次真退了没有 + 退完的余额。
 *
 * <p>★ {@code refunded} 这一位必须有。扫描时"这本已经结算过"是常态，
 * 分不清"退了一本"与"本来就没得退"的话，日志只能把两种都记成"处理过了"——
 * 而那正好是"对账看起来跑了、其实什么都没做"的形状。
 */
public record SettleResult(boolean refunded, int balance) {}
