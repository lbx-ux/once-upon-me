package com.onceuponme.api.auth.dto;

/**
 * 发验证码的结果。
 *
 * @param ok 发出去（或开发模式下"本该发出去"）了
 * @param devMode ★ 这一档**没有真发**。界面要如实显示这一点——
 *     一个悄悄不发的短信通道，会让人在生产上也以为它在发
 * @param hint 给界面直接显示的一句话（开发模式下就是那句"验证码固定 123456"）
 */
public record SendCodeResult(boolean ok, boolean devMode, String hint) {

  public static SendCodeResult sent() {
    return new SendCodeResult(true, false, null);
  }

  public static SendCodeResult devSent(String hint) {
    return new SendCodeResult(true, true, hint);
  }
}
