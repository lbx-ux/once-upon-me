package com.onceuponme.api.auth.sms;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Component;

import com.onceuponme.api.auth.SmsSendLog;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.mapper.SmsSendLogMapper;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

/**
 * 短信频控：**不花钱的那道闸**。
 *
 * <p>三层，从近到远：
 *
 * <table>
 *   <tr><th>层</th><th>窗口</th><th>挡的是</th></tr>
 *   <tr><td>同号 60 秒 / 每小时 3 条 / 每日 10 条</td><td>秒·时·天</td><td>一个人手滑连点，或拿一个号刷</td></tr>
 *   <tr><td>同 IP 每小时 5 条 / 每日 20 条</td><td>时·天</td><td>一台机器换着号刷</td></tr>
 *   <tr><td>全局每日 300 条</td><td>天</td><td>★ 分布式换 IP 刷——**这是最后一道，也是唯一一道真正硬的上限**</td></tr>
 * </table>
 *
 * <p>★ 为什么这么在意：站上公网、注册开放之后，短信接口就是一条**直接连着钱**的接口。
 * 阿里云自己也有频控，但那是"按它的规则"，而我们要的是"今天最多花多少"。
 * 前两层都在本地判、都写进 {@code sms_send_log}，所以真被刷的那天，
 * 日志里能看见是从哪个 IP 来的。
 *
 * <p>★ 为什么不用 Redis：这是一张几百行的表 + 三个 {@code COUNT}，
 * 而 2C2G 的机器上再起一个 Redis 只是多一个要维护、会挂、要备份的东西。
 * 什么时候该换：这张表一天几万行的时候（那时 {@code COUNT} 才开始变慢），
 * 而按 300/天的硬顶，它永远到不了。
 *
 * <p>★ 时钟是注入的（同 {@code LoginAttemptGuard}）：这一层逻辑的内容全是"多久算久"，
 * 拨不动时钟就测不了。
 */
@Component
public class SmsRateLimiter {

  private final SmsSendLogMapper logs;
  private final AppProperties.Sms limits;
  private final Clock clock;

  public SmsRateLimiter(SmsSendLogMapper logs, AppProperties properties, Clock clock) {
    this.logs = logs;
    this.limits = properties.sms();
    this.clock = clock;
  }

  /**
   * 现在能不能给这个号发一条。不能就抛（消息里说清还要等多久）。
   *
   * ★ 顺序是**从最便宜、最可能命中的一层开始**：同号 60 秒这一条几乎拦下所有
   * 真实的连点，把它放前面，另外几条 {@code COUNT} 就不用查了。
   */
  public void check(String phone, String ip) {
    LocalDateTime now = LocalDateTime.now(clock);

    long lastMinute = logs.countByPhoneSince(phone, now.minusSeconds(limits.samePhoneSeconds()));
    if (lastMinute > 0) {
      throw ApiException.tooMany("刚发过一条，请等 " + limits.samePhoneSeconds() + " 秒再试");
    }

    List<String> reasons = new ArrayList<>();
    long phoneHour = logs.countByPhoneSince(phone, now.minusHours(1));
    if (phoneHour >= limits.samePhoneHourly()) {
      reasons.add("这个号码一小时内已经发了 " + phoneHour + " 条");
    }
    long phoneDay = logs.countByPhoneSince(phone, now.minusDays(1));
    if (phoneDay >= limits.samePhoneDaily()) {
      reasons.add("这个号码今天已经发了 " + phoneDay + " 条");
    }
    long ipHour = logs.countByIpSince(ip, now.minusHours(1));
    if (ipHour >= limits.sameIpHourly()) {
      reasons.add("这台设备一小时内已经发了 " + ipHour + " 条");
    }
    long ipDay = logs.countByIpSince(ip, now.minusDays(1));
    if (ipDay >= limits.sameIpDaily()) {
      reasons.add("这台设备今天已经发了 " + ipDay + " 条");
    }
    long globalDay = logs.countAllSince(now.minusDays(1));
    if (globalDay >= limits.globalDaily()) {
      reasons.add("今天全站已经发了 " + globalDay + " 条（上限 " + limits.globalDaily() + "）");
    }

    if (!reasons.isEmpty()) {
      throw ApiException.tooMany(String.join("；", reasons) + "。请稍后再试或用密码登录");
    }
  }

  /** 发出去之后记一笔。★ 只有真的走到"要发了"才记——被频控挡下的请求不该也记一笔 */
  public void record(String phone, String ip) {
    logs.insert(new SmsSendLog(phone, ip, LocalDateTime.now(clock)));
  }

  /** 管理页要显示"今天花了多少条"时用它 */
  public long todayCount() {
    return logs.countAllSince(LocalDateTime.now(clock).minusDays(1));
  }
}
