package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 正等着被核验的一个验证码（一人一行，新的一条覆盖旧的）。
 * 表结构与"为什么存 HMAC 而不是明文"写在 {@code db/schema.sql} 上。
 */
@TableName("sms_codes")
public class SmsCode {

  @TableId
  private String phone;

  private String codeHash;
  private LocalDateTime sentAt;
  private LocalDateTime expiresAt;
  private int attempts;

  public SmsCode() {}

  public SmsCode(String phone, String codeHash, LocalDateTime sentAt, LocalDateTime expiresAt) {
    this.phone = phone;
    this.codeHash = codeHash;
    this.sentAt = sentAt;
    this.expiresAt = expiresAt;
    this.attempts = 0;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getCodeHash() {
    return codeHash;
  }

  public void setCodeHash(String codeHash) {
    this.codeHash = codeHash;
  }

  public LocalDateTime getSentAt() {
    return sentAt;
  }

  public void setSentAt(LocalDateTime sentAt) {
    this.sentAt = sentAt;
  }

  public LocalDateTime getExpiresAt() {
    return expiresAt;
  }

  public void setExpiresAt(LocalDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  public int getAttempts() {
    return attempts;
  }

  public void setAttempts(int attempts) {
    this.attempts = attempts;
  }
}
