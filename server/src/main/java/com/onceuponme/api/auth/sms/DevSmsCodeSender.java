package com.onceuponme.api.auth.sms;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 开发模式那一档：**不真发**，验证码固定 {@code 123456}。
 *
 * <p>★ 它为什么必须存在：这一轮的登录要真发短信，而真发是**按条计费**的。
 * 开发时每改一次流程就发一条真短信，既慢又花钱；而"没配 AccessKey 就起不来"
 * 会让任何人拿到这个仓库之后先卡在第一步。所以本地默认就是这一档
 * （{@code application-local.yml} 里 {@code app.sms.enabled: false}）。
 *
 * <p>★ 但它**不许假装发过了**：接口响应里带一个
 * {@code {devMode: true, hint: "开发模式，验证码固定 123456，没有真正发送"}}，
 * 界面据此显示这一句。这是这个仓库那条"没有的东西直说没有"的同一件事——
 * 一个悄悄不发的短信通道，会让人在生产上也以为它在发。
 *
 * <p>★ 频控照样生效（{@link SmsRateLimiter} 与实现无关）：不然本地就测不到
 * "60 秒内不能重发"这条会真的拦住人的规则。
 */
@Component
@ConditionalOnProperty(name = "app.sms.enabled", havingValue = "false")
public class DevSmsCodeSender implements SmsCodeSender {

  private static final Logger log = LoggerFactory.getLogger(DevSmsCodeSender.class);

  /** 开发模式唯一认的那个码。★ 与 README 里写给读者的一行字是同一个值 */
  public static final String DEV_CODE = "123456";

  public DevSmsCodeSender() {
    log.warn("短信通道是**开发模式**：不真发，验证码固定 {}（要真发就把 APP_SMS_ENABLED 设成 true 并配齐四项）", DEV_CODE);
  }

  @Override
  public void send(String phone) {
    // 只留号段，理由见 AliyunSmsCodeSender 的同名方法
    log.info("（开发模式）本该给号段 {} 发一条验证码，现在只在这里说一声", mask(phone));
  }

  @Override
  public boolean verify(String phone, String code) {
    return DEV_CODE.equals(code == null ? null : code.trim());
  }

  @Override
  public boolean devMode() {
    return true;
  }

  private static String mask(String phone) {
    return phone != null && phone.length() == 11
        ? phone.substring(0, 3) + "****" + phone.substring(7)
        : "***";
  }
}
