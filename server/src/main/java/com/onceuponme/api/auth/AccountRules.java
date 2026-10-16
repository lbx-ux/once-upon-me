package com.onceuponme.api.auth;

import java.util.regex.Pattern;

import com.onceuponme.api.support.ApiException;

/**
 * 账号、口令、头像 id 的形状。**一个判据只写一遍**——它同时被两条路用到：
 * 登录页那一栏（BFF 转发之前也会自己挡一道）与这里的服务端校验。
 *
 * <p>★ 三条，每条都有理由：
 *
 * <p>1. <b>登录名分两种，判据是"它是不是手机号"</b>：11 位、以 1 开头的是手机号
 * （走验证码那条路），其它 6–11 位数字是**短账号**（只能走密码）。
 * 演示账号 {@code 123456} 就是后一种。这条判据把"给一串不是手机号的数字发短信"
 * 变成结构上不可能的事，而不是靠某个 if 记着别发。
 *
 * <p>2. <b>口令下限 8 位</b>，与界面那句「至少 8 位」是**同一个数**（前端
 * {@code lib/auth/client.ts} 的 {@code PASSWORD_MIN}）。★ 但注意：这条下限只管
 * **自己设密码**那一步；登录时只比对哈希。所以演示账号那个 6 位的 {@code 123456}
 * 能登进去——它是预置的，不是谁新设的。把下限加到登录路径上，只会让这个账号登不进。
 *
 * <p>3. <b>头像只收一个 id 的形状</b>（{@code ^[a-z0-9_-]{1,32}$}），不收 URL。
 * 头像是前端自己的资产，后端只记住"这个人挑了哪一个"；收 URL 等于让陌生人
 * 往你的页面上挂一张外部图。
 */
public final class AccountRules {

  /** ★ 与前端 {@code PASSWORD_MIN} 同值。改要两边一起改（写在这里就是为了让人搜得到） */
  public static final int PASSWORD_MIN = 8;

  public static final int NICKNAME_MAX = 24;

  private static final Pattern PHONE = Pattern.compile("^1\\d{10}$");
  private static final Pattern ACCOUNT = Pattern.compile("^\\d{6,11}$");
  private static final Pattern AVATAR = Pattern.compile("^[a-z0-9_-]{1,32}$");
  private static final Pattern CODE = Pattern.compile("^\\d{6}$");

  private AccountRules() {}

  /** 这个登录名是一个能收短信的手机号吗 */
  public static boolean isPhone(String account) {
    return account != null && PHONE.matcher(account).matches();
  }

  public static void requireAccount(String account) {
    if (account == null || !ACCOUNT.matcher(account.trim()).matches()) {
      throw ApiException.badRequest("invalid-account", "请输入 11 位手机号，或 6 位以上的账号");
    }
  }

  public static void requirePassword(String password) {
    if (password == null || password.length() < PASSWORD_MIN) {
      throw ApiException.badRequest("weak-password", "密码至少 " + PASSWORD_MIN + " 位");
    }
  }

  public static void requireCode(String code) {
    if (code == null || !CODE.matcher(code.trim()).matches()) {
      throw ApiException.badRequest("invalid-code", "请输入 6 位验证码");
    }
  }

  public static void requireAvatarId(String avatar) {
    if (avatar == null || !AVATAR.matcher(avatar).matches()) {
      throw ApiException.badRequest("invalid-avatar", "这个头像编号不认识");
    }
  }
}
