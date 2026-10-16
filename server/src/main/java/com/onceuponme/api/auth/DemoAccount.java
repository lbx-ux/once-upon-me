package com.onceuponme.api.auth;

/**
 * 演示账号。★ 它的存在是**用户点名要的**（2026-10-16：「提供一个默认测试账号，
 * 账号 123456，密码 123456」），用途是评委/演示时不必收短信就能进门。
 *
 * <p>★ 因此它是这个系统里唯一一个"口令写在代码里"的账号，而这件事必须直说后果：
 * <b>站上公网之后，任何人只要知道这两行字就能用它生成绘本——花的是站长的钱。</b>
 * 所以：
 *
 * <ul>
 *   <li>启动日志里会打印一条醒目的话（见 {@code AccountSeeder}）；
 *   <li>管理页会在它那一行上显示一句提醒；
 *   <li>README §五 写了怎么停掉它（一条 DELETE + 重启）。
 * </ul>
 *
 * <p>★ 它为什么是 {@code USER} 而不是 {@code ADMIN}：演示要的是"能用四个能力"，
 * 不需要"能改别人的权限"。把演示账号做成管理员，等于把管理页也一起公开了。
 *
 * <p>★ 它为什么可以用一个 6 位的口令，而别人得 8 位：口令下限（{@code AccountRules.PASSWORD_MIN}）
 * 管的是"**自己设**密码"那一步；它是预置的，不是谁设的。
 */
public final class DemoAccount {

  public static final String ACCOUNT = "123456";
  public static final String PASSWORD = "123456";

  private DemoAccount() {}

  /** 停掉它的一句话（写在日志与 README 里，两处同一句） */
  public static String howToDisable() {
    return "DELETE FROM users WHERE account = '" + ACCOUNT + "'; 然后重启服务";
  }
}
