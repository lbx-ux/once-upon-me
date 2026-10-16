package com.onceuponme.api.config;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.onceuponme.api.auth.Times;

/**
 * 那个"现在几点"的来源。
 *
 * <p>★ 为什么把 {@link Clock} 做成一个 bean，而不是让每个类自己 `Clock.system()`
 * 或者"再写一个收 Clock 的构造器给测试用"：后者我们**写了两遍，也踩了两遍**——
 * 一个类有两个构造器而没标 {@code @Autowired} 时，Spring 会去找无参构造器，
 * 找不到就报一句听起来像代码写错了的 "No default constructor found"
 * （{@code SmsRateLimiter} 与 {@code SmsCodeStore} 各中过一次）。
 * 收成一个 bean 之后，每个类只剩**一个**构造器，测试照样能喂自己那个可以拨的钟。
 *
 * <p>★ 时区钉在 {@code Asia/Shanghai}（与 {@code Times.ZONE}、与 JDBC 串里那个
 * {@code serverTimezone} 一致）：服务器的时区是这个，而"现在几点"写进库之后
 * 是要给人看的，不该跟着某次容器里的 TZ 环境变量漂。
 */
@Configuration
public class TimeConfig {

  @Bean
  public Clock clock() {
    return Clock.system(Times.ZONE);
  }
}
