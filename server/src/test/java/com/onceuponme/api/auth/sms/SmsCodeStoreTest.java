package com.onceuponme.api.auth.sms;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import com.onceuponme.api.auth.SmsCode;
import com.onceuponme.api.auth.mapper.SmsCodeMapper;
import com.onceuponme.api.config.AppProperties;

/**
 * 验证码的存与核。四件事：**对的通过、错的不通过、一个码只试五次、用过就没了**。
 *
 * <p>★ 时钟是拨着测的（同 {@code LoginAttemptGuardTest}）：有效期是这一层的核心，
 * 而它只有能拨快时钟才测得了。
 */
@SpringBootTest(
    properties =
        "spring.datasource.url=jdbc:h2:mem:smscode-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
@ActiveProfiles("test")
class SmsCodeStoreTest {

  private static final class MutableClock extends Clock {
    private Instant now = Instant.parse("2026-10-16T12:00:00Z");

    void advance(Duration by) {
      now = now.plus(by);
    }

    @Override
    public ZoneOffset getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(java.time.ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }

  @Autowired private SmsCodeMapper codes;
  @Autowired private AppProperties properties;

  /** ★ 自己那个可以拨的钟：有效期是这一层的核心，而它只有能拨快时钟才测得了 */
  private final MutableClock clock = new MutableClock();

  private SmsCodeStore store() {
    return new SmsCodeStore(codes, properties, clock);
  }

  @Test
  @DisplayName("发出去的码能核验通过，而且**存的是 HMAC 不是明文**")
  void issuedCodeVerifiesAndIsHashed() {
    SmsCodeStore store = store();
    String code = store.issue("13800138000");

    SmsCode row = codes.selectById("13800138000");
    assertThat(row.getCodeHash()).hasSize(64);
    assertThat(row.getCodeHash())
        .as("库里不许出现明文码")
        .isNotEqualTo(code)
        .doesNotContain(code);

    assertThat(store.check("13800138000", code)).isTrue();
  }

  @Test
  @DisplayName("★ 一次一用：核验通过之后同一个码再送一遍就不认了")
  void codeIsSingleUse() {
    SmsCodeStore store = store();
    String code = store.issue("13800138001");

    assertThat(store.check("13800138001", code)).isTrue();
    assertThat(store.check("13800138001", code)).isFalse();
  }

  @Test
  @DisplayName("★ 一个码最多试 5 次：第 6 次连对的码也不认了（这条才是防爆破的那条）")
  void attemptsAreCapped() {
    SmsCodeStore store = store();
    String code = store.issue("13800138002");

    for (int i = 0; i < SmsCodeStore.MAX_ATTEMPTS; i++) {
      assertThat(store.check("13800138002", "000000")).isFalse();
    }
    assertThat(store.check("13800138002", code)).as("试满之后作废").isFalse();
  }

  @Test
  @DisplayName("过期就是过期：5 分钟之后对的码也不认，而且那条记录会被清掉")
  void expiresAfterFiveMinutes() {
    SmsCodeStore store = store();
    String code = store.issue("13800138003");

    clock.advance(Duration.ofMinutes(6));

    assertThat(store.check("13800138003", code)).isFalse();
    assertThat(codes.selectById("13800138003")).as("过期的码不该继续躺在库里").isNull();
  }

  @Test
  @DisplayName("没发过码的号：核验一律不通过（不是抛异常）")
  void unknownPhoneFails() {
    assertThat(store().check("13800138004", "123456")).isFalse();
  }

  @Test
  @DisplayName("重新发一条会覆盖旧的：旧码立刻失效，新码可用（文档里 DuplicatePolicy=1 的语义）")
  void newCodeReplacesOld() {
    SmsCodeStore store = store();
    String first = store.issue("13800138005");
    String second = store.issue("13800138005");

    assertThat(second).isNotEqualTo(first);
    assertThat(store.check("13800138005", first)).as("旧码被覆盖").isFalse();
    assertThat(store.check("13800138005", second)).isTrue();
  }

  @Test
  @DisplayName("discard 之后这个号没有待核验的码（短信没发出去时用）")
  void discardRemovesTheRow() {
    SmsCodeStore store = store();
    String code = store.issue("13800138006");
    store.discard("13800138006");

    assertThat(store.check("13800138006", code)).isFalse();
  }
}
