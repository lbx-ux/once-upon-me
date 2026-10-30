package com.onceuponme.api.credit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

import com.onceuponme.api.support.ApiException;

/**
 * 兑换码的连错锁：同一个人 30 分钟内试错 8 次，锁 15 分钟。
 *
 * <p>★ 为什么还需要它：16 位码有 80 bit，猜中是天文数字级的不可能。
 * 这一层挡的不是猜中，是<b>用这个接口当免费的哈希/数据库探针</b>——
 * 每一次尝试都会让服务端算一次 HMAC、查一次库，而这不是免费的。
 *
 * <p>★ 与 {@code LoginAttemptGuard} 分开、不共用：那个的锁定文案是
 * 「密码错得太多次了，请用验证码登录」——把这句话显示在一个正在输兑换码的人面前，
 * 是在教他做一件与当下无关的事。两个不同的动作，两句不同的话。
 *
 * <p>★ 记在内存里，重启清空。这与登录那把锁是同一条取舍：它是一份"最近谁在错"的
 * 临时账，不是用户数据。真正的防线是 80 bit 与"这个接口只对登录用户开放"。
 */
@Component
public class RedeemAttemptGuard {

  /** 错到这个数就锁 */
  static final int MAX_FAILURES = 8;
  /** 锁多久 */
  static final Duration LOCK = Duration.ofMinutes(15);
  /** 多久以前的失败不算数 */
  static final Duration WINDOW = Duration.ofMinutes(30);
  /** 最多记多少个用户，到顶先清一遍过期条目 */
  static final int MAX_TRACKED = 10_000;

  private final Clock clock;
  private final Map<Long, Deque<Instant>> failures = new ConcurrentHashMap<>();

  public RedeemAttemptGuard(Clock clock) {
    this.clock = clock;
  }

  /** 这个人现在能不能试。锁着就抛 429，并说清还要等多久 */
  public void check(long userId) {
    Deque<Instant> attempts = fresh(userId);
    if (attempts.isEmpty()) {
      failures.remove(userId, attempts);
      return;
    }
    if (attempts.size() < MAX_FAILURES) return;
    Instant unlockAt = attempts.peekLast().plus(LOCK);
    Instant now = clock.instant();
    if (now.isBefore(unlockAt)) {
      long minutes = Math.max(1, Duration.between(now, unlockAt).toMinutes() + 1);
      throw new ApiException(
          org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
          "redeem-rate-limited",
          "兑换码错得有点多，请 " + minutes + " 分钟后再试");
    }
  }

  public void recordFailure(long userId) {
    if (failures.size() >= MAX_TRACKED) sweep();
    fresh(userId).addLast(clock.instant());
  }

  /** 核销成功：把这笔账清掉 */
  public void clear(long userId) {
    failures.remove(userId);
  }

  private Deque<Instant> fresh(long userId) {
    Deque<Instant> attempts = failures.computeIfAbsent(userId, key -> new ArrayDeque<>());
    Instant cutoff = clock.instant().minus(WINDOW);
    while (!attempts.isEmpty() && attempts.peekFirst().isBefore(cutoff)) {
      attempts.removeFirst();
    }
    return attempts;
  }

  private void sweep() {
    Instant cutoff = clock.instant().minus(WINDOW);
    failures.entrySet().removeIf((entry) -> {
      Deque<Instant> attempts = entry.getValue();
      while (!attempts.isEmpty() && attempts.peekFirst().isBefore(cutoff)) {
        attempts.removeFirst();
      }
      return attempts.isEmpty();
    });
  }
}
