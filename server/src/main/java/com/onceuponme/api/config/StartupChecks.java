package com.onceuponme.api.config;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import com.onceuponme.api.auth.AccountRules;

import jakarta.annotation.PostConstruct;

/**
 * 启动时的三条硬检查。★ 它们全部是"**宁可起不来，也不要带病跑**"那一种。
 *
 * <p>为什么放在启动时而不是第一次用到时：这三样东西一旦缺了或弱了，
 * 症状分别是"所有已登录的人下次请求全 401""任何人都能通过 Nginx 那条内部通路改权限"
 * "短信接口在公网上裸奔"。这些症状没有一个会告诉我"是配置漏了一项"——
 * 它们看上去都像代码坏了。所以在启动那一秒把它变成一句读得懂的话。
 *
 * <p>★ 换来的代价说清楚：本地开发时 `local` profile **不检查**这两条
 * （本地没有 JWT 密钥也没有内部令牌，检查了就等于"clone 下来跑不动"）。
 * 判据是 profile，不是"值看起来像不像测试值"——后者永远猜不准。
 */
@Component
public class StartupChecks {

  private static final Logger log = LoggerFactory.getLogger(StartupChecks.class);

  private final AppProperties properties;
  private final Environment environment;

  public StartupChecks(AppProperties properties, Environment environment) {
    this.properties = properties;
    this.environment = environment;
  }

  @PostConstruct
  void check() {
    boolean production = List.of(environment.getActiveProfiles()).contains("prod");

    checkJwtSecret(production);
    checkInternalToken(production);
    checkSmsCredentials();
    checkAdminAccount();
  }

  private void checkJwtSecret(boolean production) {
    String secret = properties.jwt() == null ? null : properties.jwt().secret();
    int length = secret == null ? 0 : secret.getBytes(StandardCharsets.UTF_8).length;

    if (length == 0) {
      if (production) {
        throw new IllegalStateException(
            "生产环境必须给 APP_JWT_SECRET（HS256 的密钥）。"
                + "本地那一档会自动生成一把随机的，代价是每次重启所有人重新登录——"
                + "所以这里它只能是生产的一条错。");
      }
      log.warn("没有配 APP_JWT_SECRET：本次运行会用一把**随机**密钥，重启后所有人都要重新登录（本地开发用，生产禁止）");
      return;
    }

    // ★ 32 字节是 HS256 的硬要求，不是我们的偏好。短了 jjwt 会抛 WeakKeyException，
    //   而那句异常读起来像"代码有问题"，其实只是密钥太短
    if (length < 32) {
      throw new IllegalStateException(
          "APP_JWT_SECRET 太短（现在 " + length + " 字节，HS256 要求至少 32）。"
              + "生成一把：openssl rand -base64 48");
    }
  }

  private void checkInternalToken(boolean production) {
    String token = properties.internalToken();
    if (token != null && !token.isBlank()) {
      return;
    }
    if (production) {
      throw new IllegalStateException(
          "生产环境必须给 APP_INTERNAL_TOKEN：它是 BFF（Next）与这个服务之间的共享令牌，"
              + "Nginx 把 /backend/ 转到这里，没有它就等于那条通路对所有人开着。"
              + "生成一把：openssl rand -base64 32");
    }
    log.warn("没有配 APP_INTERNAL_TOKEN：本地这一档不校验 X-Internal-Token（服务只监听回环，生产禁止这样跑）");
  }

  private void checkSmsCredentials() {
    AppProperties.Sms sms = properties.sms();
    if (sms == null || !sms.enabled()) {
      return;
    }
    if (blank(sms.accessKeyId()) || blank(sms.accessKeySecret())) {
      throw new IllegalStateException(
          "app.sms.enabled=true 但没给 AccessKey：真发通道要 APP_SMS_ACCESS_KEY_ID / "
              + "APP_SMS_ACCESS_KEY_SECRET。不想花钱地跑流程，就把 APP_SMS_ENABLED 设成 false"
              + "（那时验证码固定 123456，接口会如实说这是开发模式）。");
    }
    if (blank(sms.signName()) || blank(sms.templateCode())) {
      throw new IllegalStateException(
          "app.sms.enabled=true 但签名或模板没给：阿里云短信服务里那两个必填值都要"
              + "（签名名在「签名管理」，模板 CODE 形如 SMS_337215196，在「模板管理」）。");
    }
    log.info("短信走真通道，签名={} 模板={}", sms.signName(), sms.templateCode());
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }

  /**
   * 管理员账号必须**过得了登录那一栏的形状**。
   *
   * <p>★ 这一条是实测出来的、不是推想的：第一版把管理员配成 {@code admin}（字母），
   * 于是 {@code AccountSeeder} 老老实实把它建进了库，而登录接口按
   * {@code AccountRules} 把它挡在一句「请输入 11 位手机号，或 6 位以上的账号」后面——
   * <b>库里有一个永远登不进去的管理员</b>。建号与登录两处各有一套判据时，
   * 这种"半边成立"的状态迟早会出现，所以在启动那一秒就把它变成一句错。
   */
  private void checkAdminAccount() {
    AppProperties.Admin admin = properties.admin();
    String account = admin == null ? null : admin.account();
    if (blank(account)) {
      return;
    }
    try {
      AccountRules.requireAccount(account);
    } catch (RuntimeException ex) {
      throw new IllegalStateException(
          "APP_ADMIN_ACCOUNT 不是合法的登录名（" + account + "）：登录页那一栏只收 6–11 位数字"
              + "（11 位手机号，或一个短账号）。用数字重配一次即可。",
          ex);
    }
    if (blank(admin.password())) {
      throw new IllegalStateException("配了 APP_ADMIN_ACCOUNT 却没给 APP_ADMIN_PASSWORD：管理员建不出来");
    }
  }
}
