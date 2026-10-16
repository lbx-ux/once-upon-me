package com.onceuponme.api.auth.sms;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

import com.onceuponme.api.auth.SmsCode;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.mapper.SmsCodeMapper;
import com.onceuponme.api.config.AppProperties;

/**
 * 验证码的家：生成、存（HMAC）、核验、以及**限次数**。
 *
 * <p>★ 为什么它在我们这边（而不是像号码认证那样交给阿里云）：站长账号里那个模板是
 * 短信服务的（`您的验证码为：${code}`），也就是"我们生成、我们下发"——
 * 文档对这种模板的原话是「阿里云接口无法校验」。
 *
 * <p>★ 而这一条其实是**赚的**：核验在本地，我们才能给一个码限次数。
 * 交给厂商核验时，"这个码被试了几次"对我们完全不可见，六位数字的爆破也就无从拦起。
 *
 * <p>★ 存 HMAC 而不是明文、也不是裸 SHA-256：六位数字只有 10^6 种，
 * 一张彩虹表就能把 `sha256(code)` 反查回来。密钥用的是 JWT 那把
 * （同一个秘密已经在两处出现，就不再造第二把）。
 */
@Component
public class SmsCodeStore {

  /** 一次性最多试几次。★ 试满就作废——防的是"拿着一个号慢慢爆破六位数" */
  static final int MAX_ATTEMPTS = 5;

  private static final Duration VALID = Duration.ofMinutes(5);
  private static final String HMAC = "HmacSHA256";

  private final SmsCodeMapper codes;
  private final SecretKeySpec key;
  private final Clock clock;
  private final SecureRandom random = new SecureRandom();

  public SmsCodeStore(SmsCodeMapper codes, AppProperties properties, Clock clock) {
    this.codes = codes;
    this.clock = clock;
    AppProperties.Jwt jwt = properties.jwt();
    String secret = jwt == null || jwt.secret() == null ? "" : jwt.secret();
    // 没配密钥时（本地那一档）用一句固定的字面值：它是"这台机器上的开发环境"，
    // 而不是一个需要保密的凭据——真正的秘密在生产那份配置里
    String material = secret.isBlank() ? "local-dev-only-not-a-secret" : secret;
    this.key = new SecretKeySpec(material.getBytes(StandardCharsets.UTF_8), HMAC);
  }

  /**
   * 给这个号生成一个新码并记下来（覆盖旧的：文档里那个 `DuplicatePolicy=1` 的语义，
   * 而这里它是唯一可能的行为——一人一行）。
   *
   * @return 明文码，**只在这一刻存在于内存里**，调用方拿它去发短信，然后忘掉它
   */
  public String issue(String phone) {
    String code = sixDigits();
    LocalDateTime now = LocalDateTime.now(clock);
    SmsCode row = new SmsCode(phone, hash(phone, code), now, now.plus(VALID));

    if (codes.selectById(phone) == null) {
      codes.insert(row);
    } else {
      codes.updateById(row);
    }
    return code;
  }

  /** 核验一次。★ 不管对不对都会 `attempts + 1`；试满 {@link #MAX_ATTEMPTS} 次就作废 */
  public boolean check(String phone, String candidate) {
    SmsCode row = codes.selectById(phone);
    if (row == null) {
      return false;
    }
    if (row.getExpiresAt().isBefore(LocalDateTime.now(clock))) {
      // 过期了：顺手删掉，免得它在下一次"这个号有没有码"的判断里被当成真的
      codes.deleteById(phone);
      return false;
    }
    if (row.getAttempts() >= MAX_ATTEMPTS) {
      codes.deleteById(phone);
      return false;
    }

    row.setAttempts(row.getAttempts() + 1);
    boolean ok = candidate != null && MessageDigest.isEqual(
        hash(phone, candidate.trim()).getBytes(StandardCharsets.UTF_8),
        row.getCodeHash().getBytes(StandardCharsets.UTF_8));

    if (ok) {
      // 一次一用：核验通过就把这条删掉（不然它还能在有效期内被重放一次）
      codes.deleteById(phone);
    } else {
      codes.updateById(row);
    }
    return ok;
  }

  /** 六位数字。★ 用 `SecureRandom` 而不是 `Math.random()`：后者是可预测的伪随机 */
  private String sixDigits() {
    return String.format("%06d", random.nextInt(1_000_000));
  }

  /**
   * 把一条待核验的码丢掉（短信没发出去时用）。
   * ★ 没发出去就不该留一条待核验的码：它没人知道，留着只会让"这个号有码"变成一句假话。
   */
  public void discard(String phone) {
    codes.deleteById(phone);
  }

  private String hash(String phone, String code) {
    try {
      Mac mac = Mac.getInstance(HMAC);
      mac.init(key);
      // 把手机号也揉进去：同一个码发给两个人时，两条记录的哈希不该相同
      byte[] digest = mac.doFinal((phone + ":" + code).getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
      }
      return hex.toString();
    } catch (Exception ex) {
      // 一个必然存在的算法拿不到，是环境坏了——这种时候抛出去比"静默放行"正确得多
      throw new IllegalStateException("算不出验证码的 HMAC", ex);
    }
  }
}
