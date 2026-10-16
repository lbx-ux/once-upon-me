package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 发过一条验证码的账。★ 它记的是**谁在什么时候要过一次码**，
 * 不是码本身——码由阿里云生成、也由阿里云核验，我们这边一个字节都不存
 * （存了就要自己管过期、自己管比对，而那是另一份真相）。
 *
 * <p>频控三层（同号 / 同 IP / 全局每日）全部从这张表按时间窗数出来，
 * 所以它同时是审计：真有人刷的那天，日志里能看见是从哪个 IP 来的。
 */
@TableName("sms_send_log")
public class SmsSendLog {

  @TableId(type = IdType.AUTO)
  private Long id;

  private String phone;
  private String ip;
  private LocalDateTime sentAt;

  public SmsSendLog() {}

  public SmsSendLog(String phone, String ip, LocalDateTime sentAt) {
    this.phone = phone;
    this.ip = ip;
    this.sentAt = sentAt;
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getIp() {
    return ip;
  }

  public void setIp(String ip) {
    this.ip = ip;
  }

  public LocalDateTime getSentAt() {
    return sentAt;
  }

  public void setSentAt(LocalDateTime sentAt) {
    this.sentAt = sentAt;
  }
}
