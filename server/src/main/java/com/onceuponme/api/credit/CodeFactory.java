package com.onceuponme.api.credit;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

import com.onceuponme.api.config.AppProperties;

/**
 * 兑换码的生成、规范化与哈希。★ 明文只在生成的那一次出现在内存里，之后只剩 HMAC。
 *
 * <p>三条决定：
 *
 * <p>1. <b>字母表 32 个，去掉 {@code 0 O 1 I}。</b>这些码会被电话报、被手抄、
 * 被老师写在纸上发给家长。`0/O` 与 `1/I` 是抄错的两大来源，而少四个字符
 * 只把每位的熵从 5 bit 降到 5 bit（32 个字符本来就正好 5 bit）。
 *
 * <p>2. <b>16 位 = 80 bit。</b>这个长度不是拍出来的：10 位是 50 bit，在线爆破
 * 在有频控的前提下勉强够；16 位留了一个数量级的余量，而手抄 16 位仍然可接受
 * （分成四组 `XXXX-XXXX-XXXX-XXXX`）。
 *
 * <p>3. <b>哈希用 HMAC，密钥沿用 JWT 那把。</b>与 {@code SmsCodeStore} 同一条理由：
 * 同一个秘密已经在两处出现，就不再造第二把；而裸 SHA-256 挡不住"库被读走之后
 * 用一张表反查"——虽然 80 bit 让反查不现实，但用 HMAC 是零成本的正确做法。
 *
 * <p>★ 规范化（{@link #normalize}）要宽进严出：用户会带连字符、空格、小写，
 * 这些都应该被接受；但字母表之外的字符（比如把 `0` 抄成 `O`）不会被"猜"成正确的，
 * 而是直接被判为形状不对——猜错一次就是在替用户改他的钱。
 */
@Component
public class CodeFactory {

  /** 32 个字符：`2-9` 与 `A-Z` 去掉 `I`、`O`。★ 见类上第 1 条 */
  static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

  /** 明文码长度（不含分组连字符） */
  public static final int LENGTH = 16;

  /** 后四位存下来，只用于对账 */
  public static final int TAIL = 4;

  private static final String HMAC = "HmacSHA256";

  private final SecureRandom random = new SecureRandom();
  private final SecretKeySpec key;

  public CodeFactory(AppProperties properties) {
    AppProperties.Jwt jwt = properties.jwt();
    String secret = jwt == null || jwt.secret() == null ? "" : jwt.secret();
    // 与 SmsCodeStore 逐字相同的那一条：本地没配密钥时用一句固定字面值。
    //   它不是秘密，真正的秘密在生产那份配置里；而两边用同一个兜底值，
    //   本地生成的码在本地核销得掉——这正是"开发环境跑得起来"的意思
    String material = secret.isBlank() ? "local-dev-only-not-a-secret" : secret;
    this.key = new SecretKeySpec(material.getBytes(StandardCharsets.UTF_8), HMAC);
  }

  /** 生成一张新码。★ 明文只在这一刻存在；调用方拿它写进 CSV 之后就该忘掉 */
  public String newCode() {
    StringBuilder code = new StringBuilder(LENGTH);
    for (int i = 0; i < LENGTH; i++) {
      code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
    }
    return code.toString();
  }

  /**
   * 用户输入的码 → 规范形（大写、只留字母数字）。
   *
   * <p>★ 不做"把 O 当成 0"这类纠错：字母表里根本没有 0/O，所以那种纠错只会在
   * 用户真抄错时把一张别人的码变成"看起来合法"的样子。宽进的边界是格式，
   * 不是内容。
   */
  public String normalize(String raw) {
    if (raw == null) return "";
    StringBuilder out = new StringBuilder(LENGTH);
    for (char ch : raw.toCharArray()) {
      if (ch >= 'a' && ch <= 'z') {
        out.append((char) (ch - 'a' + 'A'));
      } else if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
        out.append(ch);
      }
      // 连字符、空格、全角字符一律丢掉——它们是输入方式，不是码的一部分
    }
    return out.toString().toUpperCase(Locale.ROOT);
  }

  /** 规范形是不是一张"长得对"的码。★ 只判形状，不判存在 */
  public boolean looksLikeCode(String normalized) {
    if (normalized == null || normalized.length() != LENGTH) return false;
    for (char ch : normalized.toCharArray()) {
      if (ALPHABET.indexOf(ch) < 0) return false;
    }
    return true;
  }

  /** 主键：HMAC(规范形)。★ 明文永不落库 */
  public String hash(String normalized) {
    try {
      Mac mac = Mac.getInstance(HMAC);
      mac.init(key);
      byte[] digest = mac.doFinal(normalized.getBytes(StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
      }
      return hex.toString();
    } catch (Exception ex) {
      // 一个必然存在的算法拿不到，是环境坏了——抛出去比"静默放行"正确得多
      throw new IllegalStateException("算不出兑换码的 HMAC", ex);
    }
  }

  /** 后四位。★ 只用于对账，不足以还原整张码 */
  public String tailOf(String normalized) {
    return normalized.substring(Math.max(0, normalized.length() - TAIL));
  }

  /** 给人看的分组形（CSV 与界面上都长这样） */
  public String format(String normalized) {
    if (normalized.length() != LENGTH) return normalized;
    StringBuilder out = new StringBuilder(LENGTH + 3);
    for (int i = 0; i < LENGTH; i++) {
      if (i > 0 && i % 4 == 0) out.append('-');
      out.append(normalized.charAt(i));
    }
    return out.toString();
  }
}
