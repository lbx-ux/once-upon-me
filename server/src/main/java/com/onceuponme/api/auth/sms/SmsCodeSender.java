package com.onceuponme.api.auth.sms;

/**
 * 发验证码、核验它。两个实现由 {@code app.sms.enabled} 选一个：
 * {@link AliyunSmsCodeSender}（真发）与 {@link DevSmsCodeSender}（假发，码固定 123456）。
 *
 * <p>★ 这一轮改过一处判断，写下来免得下一个人按旧的理解去读：
 * 原来这两个方法在一个接口里，理由是"阿里云生成的码只能由阿里云核验"。
 * 而站长账号里那个模板是**短信服务**的（`${code}` 由我们填），
 * 文档对这种模板的原话是「阿里云接口无法校验」——所以核验落在
 * {@link SmsCodeStore}，两个方法的关系变成了"**同一个实现手里的同一件事**"：
 * 真发那一份 issue 一个码发出去、再用同一个 store 核验。
 * 接口没变，是因为对调用方（{@code AuthService}）来说它一直是"发"和"验"两件事。
 *
 * <p>★ 后者的存在不是为了省事，是为了**别让任何人 clone 下来就先把钱花在短信上**。
 */
public interface SmsCodeSender {

  /**
   * 给这个号码发一条验证码。
   *
   * @throws com.onceuponme.api.support.ApiException 发不出去时抛，且带一句能读给人看的话
   */
  void send(String phone);

  /**
   * 核验。★ 返回布尔而不是抛异常：**码不对是日常**，不是异常。
   * 真正该抛的是"通道/网络坏了"——那两件事在界面上说的话完全不同
   * （"验证码不对" vs "服务暂时不可用"），混成一个的话，后者会伪装成前者，
   * 让人一直去改一个本来没错的码。
   */
  boolean verify(String phone, String code);

  /** 这一档是不是"没真发"。响应里要如实说，不能让开发模式假装发过了 */
  boolean devMode();
}
