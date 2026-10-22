package com.onceuponme.api.auth;

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
 * 密码登录的连错锁：同一个登录名 15 分钟内错 5 次，锁 10 分钟。
 *
 * <p>★ 为什么要有它（这一轮之前不需要）：<b>站上公网了</b>，而公网上的密码接口
 * 每秒可以被试很多次。短信那一侧有三层频控，密码这一侧如果什么都不做，
 * 那道闸就形同虚设——攻击者不会去猜验证码，他会来猜密码。
 *
 * <p>★ 记在**内存**里，不落库：这是一份"最近谁在错"的临时账，
 * 而不是用户数据。代价说清楚——**重启会清空**，也就是说重启之后那 5 次的计数从头来。
 * 对"挡一挡在线爆破"这个目的来说，这个代价可以接受（攻击者控制不了你什么时候重启）；
 * 真要做成持久的那天，它该进的是一张带过期的表，而不是往 users 上加两列。
 *
 * <p>★ 时钟是**注入**的（默认走系统时钟）：这一条逻辑的全部内容就是"多久算久"，
 * 而它只有在能拨快时钟的时候才测得了。测试里给一个假的 Clock，见
 * {@code LoginAttemptGuardTest}。
 */
@Component
public class LoginAttemptGuard {

  /** 错到这个数就锁 */
  static final int MAX_FAILURES = 5;
  /** 锁多久 */
  static final Duration LOCK = Duration.ofMinutes(10);
  /** 多久以前的失败不算数（否则一个记性太好的计数会让人几个月后被"翻旧账"） */
  static final Duration WINDOW = Duration.ofMinutes(15);
  /** 这张临时账最多记多少个登录名；到顶就先清一遍过期条目（内存不是无限的） */
  static final int MAX_TRACKED = 10_000;

  private final Clock clock;
  private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

  public LoginAttemptGuard(Clock clock) {
    this.clock = clock;
  }

  /** 这个人现在能不能试密码。锁着就抛（消息里带上还要等多久） */
  public void check(String account) {
    Deque<Instant> attempts = fresh(account);
    if (attempts.isEmpty()) {
      // ★ 这个键是 fresh 刚刚为一次尝试建出来的（或者窗口里的记录已经全过期）：
      //   现在没有要记的东西，就把它删掉。原来只清队列、不删键，于是每一个被
      //   试过一次的登录名都会在这张表里留一个永久空壳——登录接口在认人之前就调
      //   check，6–11 位数字的账号又是无穷的，几百次请求就能把这张表撑大
      //   （2026-10-22 审查）。
      failures.remove(account, attempts);
      return;
    }
    if (attempts.size() < MAX_FAILURES) {
      return;
    }
    Instant last = attempts.peekLast();
    Instant unlockAt = last.plus(LOCK);
    Instant now = clock.instant();
    if (now.isBefore(unlockAt)) {
      long minutes = Math.max(1, Duration.between(now, unlockAt).toMinutes() + 1);
      throw ApiException.locked("密码错得太多次了，请 " + minutes + " 分钟后再试，或者用验证码登录");
    }
  }

  /** 记一次失败 */
  public void recordFailure(String account) {
    if (failures.size() >= MAX_TRACKED) {
      sweep(clock.instant());
    }
    Deque<Instant> attempts = fresh(account);
    attempts.addLast(clock.instant());
  }

  /** 登录成功：把这笔账清掉（否则"错了四次然后想起来密码"的人下一次错就被锁） */
  public void clear(String account) {
    failures.remove(account);
  }

  /** 去掉窗口外的旧记录。空队列不在这里删——`recordFailure` 接着就要往里写 */
  private Deque<Instant> fresh(String account) {
    Deque<Instant> attempts = failures.computeIfAbsent(account, key -> new ArrayDeque<>());
    Instant cutoff = clock.instant().minus(WINDOW);
    while (!attempts.isEmpty() && attempts.peekFirst().isBefore(cutoff)) {
      attempts.removeFirst();
    }
    return attempts;
  }

  /** 把已经没有任何窗口内记录的登录名整条移出表（到上限时调用） */
  private void sweep(Instant now) {
    Instant cutoff = now.minus(WINDOW);
    failures.entrySet().removeIf((entry) -> {
      Deque<Instant> attempts = entry.getValue();
      while (!attempts.isEmpty() && attempts.peekFirst().isBefore(cutoff)) {
        attempts.removeFirst();
      }
      return attempts.isEmpty();
    });
  }
}
