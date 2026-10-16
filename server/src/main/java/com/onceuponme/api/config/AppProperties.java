package com.onceuponme.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * {@code app.*} 那一组配置。★ 用一个 record 而不是散落的 {@code @Value}：
 * 这些值是同一件事的几个面（这个服务是谁、能往外说什么、发短信花谁的钱），
 * 散开之后"还有哪些开关"只能靠 grep。
 *
 * <p>★ 这里**没有任何默认秘密**。口令与密钥全部从环境变量来
 * （生产是 {@code /etc/xiaozhujue/api.yml}，600 权限），仓库里只有字段名。
 */
@ConfigurationProperties("app")
public record AppProperties(
    @DefaultValue Jwt jwt,
    String internalToken,
    @DefaultValue Admin admin,
    @DefaultValue Sms sms) {

  /**
   * @param secret HS256 的密钥。★ **至少 32 字节**，这是 HS256 的硬要求，
   *     也是这一轮唯一一条"两侧必须逐字一样"的约定：Java 与 Next 各拿这串原始字节
   *     去算 HMAC，**不做任何派生**（一派生就多一种"两边算得不一样"的可能，
   *     而它的症状是"登录明明成功，下一个请求就 401"）。长度由 {@link StartupChecks} 在启动时把关。
   * @param ttlHours 会话有效期（小时）
   * @param ticketMinutes "验证码已核验"那张票的有效期（分钟），只够用来设一次密码
   */
  public record Jwt(String secret, @DefaultValue("168") int ttlHours, @DefaultValue("5") int ticketMinutes) {}

  /**
   * 管理员账号：**只在库里还没有管理员时**用来建号。
   * ★ 留空就跳过建号，绝不自己编一个默认口令——那会变成一个公开的入口。
   */
  public record Admin(String account, String password) {}

  /**
   * 短信通道与频控。
   *
   * @param enabled 是否真发。false 时用开发模式那一份实现（码固定 123456，
   *     响应里如实说"未真正发送"，见 {@code DevSmsCodeSender}）
   * @param signName 阿里云赠送签名名
   * @param templateCode 阿里云赠送模板 CODE
   * @param samePhoneSeconds 同号最短间隔（秒）
   * @param samePhoneHourly 同号每小时上限
   * @param samePhoneDaily 同号每日上限
   * @param sameIpHourly 同 IP 每小时上限
   * @param sameIpDaily 同 IP 每日上限
   * @param globalDaily 全局每日硬顶——★ 这一条是"开放注册"的兜底：
   *     前面几层是按号/按 IP 的，被人换着号刷时只有这一条拦得住
   * @param registrationOpen 自助注册开关（管理页上可改）
   */
  public record Sms(
      @DefaultValue("true") boolean enabled,
      String signName,
      String templateCode,
      String accessKeyId,
      String accessKeySecret,
      @DefaultValue("60") int samePhoneSeconds,
      @DefaultValue("3") int samePhoneHourly,
      @DefaultValue("10") int samePhoneDaily,
      @DefaultValue("5") int sameIpHourly,
      @DefaultValue("20") int sameIpDaily,
      @DefaultValue("300") int globalDaily,
      @DefaultValue("true") boolean registrationOpen) {}
}
