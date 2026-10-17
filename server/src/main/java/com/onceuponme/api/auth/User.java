package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一个账号。表结构与理由写在 {@code db/schema.sql} 里，这里只说三处字段的用法。
 *
 * <p>★ {@code passwordHash} 可空，且**空 = 没设过密码**（不是"密码是空的"）：
 * 走验证码进来的新用户就是这一种，而它决定了这个人能不能走密码登录那条路。
 * 用"空串"表示同一件事的话，一次误写入就会把它变成一个空口令的账号。
 *
 * <p>★ {@code nickname} 空串是**合法值**（"还没起过"），界面上它长成打码手机号；
 * 这不是缺数据，所以任何"校验昵称非空"的写法都是错的。
 *
 * <p>★ 时间一律 {@link LocalDateTime}（库里是 MySQL 的 DATETIME，没有时区）。
 * 服务器的时区是 Asia/Shanghai，出参时由 {@code Times} 补上 +08:00——
 * 补这一下的理由写在那个类上：不补，另一个时区的人看到的是错的时间。
 */
@TableName("users")
public class User {

  @TableId(type = IdType.AUTO)
  private Long id;

  private String account;
  private String phone;
  private String passwordHash;
  private String nickname;
  private String avatar;
  private String role;
  private LocalDateTime createdAt;
  private LocalDateTime lastLoginAt;
  /** 密码最后一次改动的时刻。★ 早于它签发的票会被作废（见 `AuthService#requireUser`） */
  private LocalDateTime passwordChangedAt;
  /**
   * 账号状态。★ 只有 {@link #STATUS_ACTIVE} 与 {@link #STATUS_DISABLED} 两个值。
   *
   * <p>★ 它**不是**"登录一次就不查了"的东西：`AuthService#requireUser` 每次请求都看一眼，
   * 所以站长按下"停号"之后，那个人**此刻**手里那张票立刻不好使了——不是等他下次登录。
   * 与"密码代次"（`passwordChangedAt`）同一条道理，只是那一列还管"改密码踢下线"。
   *
   * <p>★ 为什么另加一列而不是复用 `passwordHash = NULL`：那个 NULL 的含义已经定死了，
   * 是"还没设过密码"。两种含义挤在一列里，下一个人必然把"停用"读成"还没设密码"。
   */
  private String status;

  /** 正常。缺省值就是它（见 `db/schema.sql` 与 `SchemaUpgrades` 的 DEFAULT） */
  public static final String STATUS_ACTIVE = "ACTIVE";

  /** 已停用。站长在管理页停的——登不进来，已经登着的会话也当场作废 */
  public static final String STATUS_DISABLED = "DISABLED";

  public static boolean isActive(User user) {
    // ★ 认不出的一律当**正常**：这一列是后来才加的，老数据（或手改过的库）可能是空串。
    //   判成"停用"的话，一次升级会把所有人关在门外——而那种故障看起来像"登录全坏了"，
    //   没人会往"多了个 status 列"上想
    return user.status == null || user.status.isBlank() || STATUS_ACTIVE.equals(user.status);
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public String getAccount() {
    return account;
  }

  public void setAccount(String account) {
    this.account = account;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getPasswordHash() {
    return passwordHash;
  }

  public void setPasswordHash(String passwordHash) {
    this.passwordHash = passwordHash;
  }

  public String getNickname() {
    return nickname;
  }

  public void setNickname(String nickname) {
    this.nickname = nickname;
  }

  public String getAvatar() {
    return avatar;
  }

  public void setAvatar(String avatar) {
    this.avatar = avatar;
  }

  public String getRole() {
    return role;
  }

  public void setRole(String role) {
    this.role = role;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getLastLoginAt() {
    return lastLoginAt;
  }

  public void setLastLoginAt(LocalDateTime lastLoginAt) {
    this.lastLoginAt = lastLoginAt;
  }

  public LocalDateTime getPasswordChangedAt() {
    return passwordChangedAt;
  }

  public void setPasswordChangedAt(LocalDateTime passwordChangedAt) {
    this.passwordChangedAt = passwordChangedAt;
  }
}
