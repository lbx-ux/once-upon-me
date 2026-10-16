package com.onceuponme.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.onceuponme.api.support.ApiException;

/**
 * 连错锁。★ 时钟是拨着测的——这一层的全部内容就是"多久算久"，
 * 而它只有在能拨快时钟的时候才测得了（用真时钟就只能 sleep，
 * 或者把窗口调到毫秒级，那测的又不是上线的那一套）。
 */
class LoginAttemptGuardTest {

  /** 一个可以拨的钟。★ 不用 Mockito 就是为了这三行——这一层不需要一个 mock 框架 */
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

  private final MutableClock clock = new MutableClock();
  private final LoginAttemptGuard guard = new LoginAttemptGuard(clock);

  @Test
  @DisplayName("错 4 次还能再试，第 5 次之后就被锁住")
  void locksAfterFiveFailures() {
    for (int i = 0; i < 4; i++) {
      guard.recordFailure("13800138000");
      guard.check("13800138000"); // 不抛
    }
    guard.recordFailure("13800138000");

    assertThatThrownBy(() -> guard.check("13800138000"))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("请")
        .extracting(ex -> ((ApiException) ex).code())
        .isEqualTo("too-many-attempts");
  }

  @Test
  @DisplayName("锁 10 分钟：9 分钟还锁着，11 分钟后放行")
  void unlocksAfterTenMinutes() {
    for (int i = 0; i < 5; i++) {
      guard.recordFailure("13800138001");
    }
    clock.advance(Duration.ofMinutes(9));
    assertThatThrownBy(() -> guard.check("13800138001")).isInstanceOf(ApiException.class);

    clock.advance(Duration.ofMinutes(2));
    guard.check("13800138001"); // 不抛
  }

  @Test
  @DisplayName("登录成功会把这笔账清掉：错了四次之后登进来，下次错不该算第五次")
  void successClearsTheAccount() {
    for (int i = 0; i < 4; i++) {
      guard.recordFailure("13800138002");
    }
    guard.clear("13800138002");
    guard.recordFailure("13800138002");

    guard.check("13800138002"); // 不抛
  }

  @Test
  @DisplayName("一个账号被锁不影响另一个账号")
  void locksArePerAccount() {
    for (int i = 0; i < 5; i++) {
      guard.recordFailure("13800138003");
    }
    assertThatThrownBy(() -> guard.check("13800138003")).isInstanceOf(ApiException.class);
    guard.check("13800138004"); // 不抛
  }

  @Test
  @DisplayName("旧失败会过期：15 分钟窗口之外的错不再累计")
  void oldFailuresExpire() {
    for (int i = 0; i < 4; i++) {
      guard.recordFailure("13800138005");
    }
    clock.advance(Duration.ofMinutes(16));
    guard.recordFailure("13800138005"); // 这一条会把窗口挪到现在，前面四条被丢掉

    guard.check("13800138005"); // 不抛
  }
}
