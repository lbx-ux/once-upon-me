package com.onceuponme.api.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 口令的哈希器。★ 引的只是 {@code spring-security-crypto} 这一个人，不是整个
 * starter-security（见 {@code pom.xml} 里那段注释：引了它，默认那条过滤器链
 * 会把所有接口一起拦掉，而我们的鉴权是自己写的一层）。
 *
 * <p>★ BCrypt 的强度用默认的 10。它是一个**有意的成本**：每约 100ms 一次，
 * 让"拿着泄露的库离线撞口令"变贵。调大它会让登录那一秒变久，而这一轮的登录频率
 * 是"一天一次"，所以不调小。
 */
@Configuration
public class CryptoConfig {

  @Bean
  public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
  }
}
