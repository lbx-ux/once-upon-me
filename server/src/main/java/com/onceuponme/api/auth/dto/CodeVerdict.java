package com.onceuponme.api.auth.dto;

/**
 * 验证码核验之后的两种结局。★ {@code kind} 的取值与前端那个
 * {@code CodeVerdict}（{@code src/lib/auth/client.ts}）一一对应：
 *
 * <ul>
 *   <li>{@code signed-in} —— 老用户，登录完了：{@code token} 是会话票，{@code user} 在
 *   <li>{@code needs-password} —— 新用户，先设密码：{@code token} 是那张 5 分钟的票
 * </ul>
 *
 * <p>★ 两种票**共用一个 {@code token} 字段**（而不是 {@code token} 与 {@code ticket} 各一个）：
 * 它们本来就是同一个东西（一张我们签的、带 scope 的令牌），而分成两个字段之后，
 * 每个读它的人都得先想"这会儿该看哪一个"。作用域由票自己写着
 * （见 {@code JwtService}），服务端会拒绝用错的票——客户端不需要理解这件事。
 */
public record CodeVerdict(String kind, String token, UserView user) {

  public static final String KIND_SIGNED_IN = "signed-in";
  public static final String KIND_NEEDS_PASSWORD = "needs-password";

  public static CodeVerdict signedIn(UserView user, String sessionToken) {
    return new CodeVerdict(KIND_SIGNED_IN, sessionToken, user);
  }

  public static CodeVerdict needsPassword(String ticket) {
    return new CodeVerdict(KIND_NEEDS_PASSWORD, ticket, null);
  }
}
