package com.onceuponme.api.auth;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

import javax.crypto.SecretKey;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * 登录令牌。两种，差别只在 {@code scope} 与有效期：
 *
 * <table>
 *   <tr><th>scope</th><th>是什么</th><th>有效期</th></tr>
 *   <tr><td>{@code session}</td><td>登录完成之后的会话</td><td>{@code app.jwt.ttl-hours}（7 天）</td></tr>
 *   <tr><td>{@code ticket}</td><td>验证码已核验、**但还没设密码**时的票</td><td>5 分钟</td></tr>
 * </table>
 *
 * <p>★ 那张票是这一轮唯一一处不显然的设计，理由是这样：前端那条契约要求
 * "设密码这个动作**只能在已通过验证码的会话里**发生"（{@code lib/auth/client.ts}
 * 的 {@code setPassword} 文档里写着"没有它，任何一个人打开控制台就能给任意号码设密码"）。
 * 但新用户在这时还**不是**一个已登录的人——给他一张 7 天的会话票，
 * 等于"没设密码就先登进来了"。所以中间用一个 5 分钟、只能用一次（用完即焚，见
 * {@code AuthService#setPassword}）、只够设密码的一次性票。
 *
 * <p>★ 权限**不进令牌**：管理员改了开关之后，下一次请求就要看得见。
 * 令牌里只放"你是谁"（sub / account / role / scope），"你能用什么"每次从库里读
 * （{@code AuthService#viewOf}）。代价是每个请求一次查库——一张几百行的表，这个代价
 * 远小于"权限改了要等 7 天才生效"。
 */
@Service
public class JwtService {

  private static final Logger log = LoggerFactory.getLogger(JwtService.class);

  private static final String CLAIM_ACCOUNT = "acc";
  private static final String CLAIM_ROLE = "role";
  private static final String CLAIM_SCOPE = "scope";
  /** 这一代密码（最后一次改密码的秒）。★ 见 {@link #passwordVersionOf} */
  private static final String CLAIM_PASSWORD_VERSION = "pv";
  private static final String SCOPE_SESSION = "session";
  private static final String SCOPE_TICKET = "ticket";

  private final SecretKey key;
  private final Duration sessionTtl;
  private final Duration ticketTtl;

  public JwtService(AppProperties properties) {
    AppProperties.Jwt jwt = properties.jwt();
    String secret = jwt == null ? null : jwt.secret();
    if (secret == null || secret.isBlank()) {
      // ★ 只可能发生在本地那一档：生产没配是启动就失败（StartupChecks）。
      //   随机一把的代价是"重启之后所有人重新登录"，这在本地无所谓
      byte[] random = new byte[48];
      new SecureRandom().nextBytes(random);
      secret = Base64.getEncoder().encodeToString(random);
      log.warn("本次运行的 JWT 密钥是随机生成的：重启之后所有人都要重新登录");
    }
    this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    this.sessionTtl = Duration.ofHours(jwt == null ? 168 : jwt.ttlHours());
    this.ticketTtl = Duration.ofMinutes(jwt == null ? 5 : jwt.ticketMinutes());
  }

  /** 登录完成：发一张会话票 */
  public String signSession(User user) {
    return sign(
        user.getId().toString(),
        user.getAccount(),
        user.getRole(),
        SCOPE_SESSION,
        sessionTtl,
        passwordVersionOf(user));
  }

  /**
   * 这一代密码的版本号（= 最后一次改密码那一刻的秒；从没改过是 0）。
   *
   * <p>★ 为什么不是"比较票的签发时间与改密码时间"：JWT 的 `iat` 只有**秒**精度，
   * 而库里的时间戳有微秒。于是一张"改密码同一秒里签发"的新票会看起来比那次改动**早**，
   * 被当成旧票踢掉——症状是"改完密码有时候被登出"，只有真跑才撞得到
   * （2026-10-16 在 `ChangePasswordIntegrationTest` 里撞到，单跑那条测试时又是绿的）。
   * 带上一个**代次**就没有这个问题：相等就是要的那一代，不等就是旧的，
   * 与时间精度无关。
   */
  private static long passwordVersionOf(User user) {
    return user.getPasswordChangedAt() == null
        ? 0L
        : user.getPasswordChangedAt().atZone(Times.ZONE).toEpochSecond();
  }

  /** 验证码通过但新用户还没设密码：发一张短命的一次性票（它不带密码代次：设密码时还没有密码） */
  public String signTicket(String account) {
    return sign(account, account, "USER", SCOPE_TICKET, ticketTtl, 0L);
  }

  /** 会话票 → 这个人是谁。签名不对、过期、或拿的是设密码那张票，一律 401 */
  public Session verifySession(String token) {
    Claims claims = parse(token);
    if (!SCOPE_SESSION.equals(claims.get(CLAIM_SCOPE, String.class))) {
      throw ApiException.unauthorized("这还不是一次登录，请先完成登录");
    }
    return new Session(
        Long.parseLong(claims.getSubject()),
        claims.get(CLAIM_ACCOUNT, String.class),
        claims.get(CLAIM_ROLE, String.class),
        // ★ 密码代次：改密码之后，旧代次的票一律作废（见 `AuthService#requireUser`）。
        //   这是这一轮**唯一**能撤销会话的手段——我们没有 token 黑名单，
        //   而"改密码"有一半的场景就是"有人知道我旧密码"，那时什么都不撤销等于没改
        claims.get(CLAIM_PASSWORD_VERSION, Number.class) == null
            ? 0L
            : claims.get(CLAIM_PASSWORD_VERSION, Number.class).longValue());
  }

  /** 设密码那张票 → 它是给哪个登录名发的 */
  public String verifyTicket(String token) {
    Claims claims = parse(token);
    if (!SCOPE_TICKET.equals(claims.get(CLAIM_SCOPE, String.class))) {
      throw ApiException.unauthorized("请先用验证码验证手机号");
    }
    return claims.getSubject();
  }

  private String sign(
      String subject, String account, String role, String scope, Duration ttl, long passwordVersion) {
    Instant now = Instant.now();
    return Jwts.builder()
        .subject(subject)
        .claim(CLAIM_ACCOUNT, account)
        .claim(CLAIM_ROLE, role)
        .claim(CLAIM_SCOPE, scope)
        .claim(CLAIM_PASSWORD_VERSION, passwordVersion)
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plus(ttl)))
        // ★ 算法必须**写死 HS256**，不能只写 `signWith(key)`。
        //   后者会让 jjwt 按密钥长度**自己挑**：密钥 ≥ 64 字节时它挑 HS512，
        //   而 Next 那一侧只认 HS256（`session.ts` 里那一行是显式写的），
        //   于是症状是"登录明明成功、下一个请求就 401"——2026-10-16 实测撞到过，
        //   当时的密钥是 65 字节（`openssl rand -base64 48` 的结果）。
        //   ★ 两侧必须逐字一样的东西，就不该有一侧是"自动挑的"。
        .signWith(key, Jwts.SIG.HS256)
        .compact();
  }

  private Claims parse(String token) {
    try {
      return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    } catch (JwtException | IllegalArgumentException ex) {
      // ★ 过期与"签名不对"回同一句话：对拿着一个坏令牌的人来说，两者的下一步是同一件事
      //   （重新登录），而分开说只会告诉攻击者"你的伪造签名是对的、只是过期了"
      throw ApiException.unauthorized("登录已过期，请重新登录");
    }
  }

  /** 谁在用这个会话，以及这张票属于**哪一代密码**（后者用来判定"密码改过没有"） */
  public record Session(long userId, String account, String role, long passwordVersion) {}
}
