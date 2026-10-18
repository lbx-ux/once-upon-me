package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 「这个人有没有创作权」——<b>一位</b>（一人一行）。
 *
 * <p>★ 2026-10-18 由"四个能力开关"收成一位，理由就是产品那一句：
 * <b>登录之后就能用各种模型，不用站长分配</b>。原先那四列（{@code can_text} /
 * {@code can_image} / {@code can_vision} / {@code can_speech}）在同一天退场——
 * 四项同真同假之后，四个必然一起动的列只会长成"看起来能分开配"的样子。
 *
 * <p>★ <b>默认是"给上"</b>（{@link #allowedFor}）。这不是把决定替站长做了：
 * 这一轮的决定本来就是"注册即全开"，站长手里留的是**收回**那一个动作
 * （{@link #of} 带上 {@code false}）。
 *
 * <p>★ 它仍然单独一张表、单独一个实体（而不是往 {@link User} 上加一列）：
 * 两张表的<b>写入方不同</b>——这张只有管理页会改，改的是"授权"这件事；
 * 而 {@code users} 那边是这个人自己在改昵称、服务端在记最后登录时间。
 * 混在一起之后，"谁把权限关了"与"谁改了昵称"会在同一条 UPDATE 里失去分别。
 *
 * <p>★ 老库上那四列还在（{@code SchemaUpgrades} 刻意不 DROP），而这个类不再映射它们：
 * 一个字段都不留，读的时候才不会有人顺手拿起其中一列当判据。
 */
@TableName("user_permissions")
public class UserPermission {

  @TableId(type = IdType.INPUT)
  private Long userId;

  /** 1 = 能用（默认），0 = 站长把这个人的权限收回了 */
  private boolean allowed;

  private LocalDateTime updatedAt;

  /** 默认的那一份：**给上**。注册、建号、已存在的库里补列，走的都是它那个 {@code true} */
  public static UserPermission allowedFor(long userId, LocalDateTime now) {
    return of(userId, true, now);
  }

  public static UserPermission of(long userId, boolean allowed, LocalDateTime now) {
    UserPermission permission = new UserPermission();
    permission.setUserId(userId);
    permission.setAllowed(allowed);
    permission.setUpdatedAt(now);
    return permission;
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public boolean isAllowed() {
    return allowed;
  }

  public void setAllowed(boolean allowed) {
    this.allowed = allowed;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }
}
