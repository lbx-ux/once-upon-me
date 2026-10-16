package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一个人的四个能力开关（一人一行）。★ 单独一张表、单独一个实体，
 * 因为它与 {@link User} 的**写入方不同**：这张表只有管理页会改，
 * 而昵称、头像、最后登录时间是"这个人自己"在改。混在一起的话，
 * "谁把权限关了"与"谁改了昵称"会在同一条 UPDATE 里失去分别。
 */
@TableName("user_permissions")
public class UserPermission {

  @TableId(type = IdType.INPUT)
  private Long userId;

  private boolean canText;
  private boolean canImage;
  private boolean canVision;
  private boolean canSpeech;
  private LocalDateTime updatedAt;

  /**
   * 新用户的默认权限：**四个全关**。
   *
   * <p>★ 这不是"偷懒的默认值"，是这一轮要演示的那条路：
   * 新注册进来的人点「开始创作」会看到「当前用户没有权限，请联系管理员」，
   * 管理员在 `/admin` 上勾一下，同一个人不用重新登录就能开始生成。
   * 默认开一半（比如写故事能用）会让这条路只在"图像"上才走得到，
   * 而那句话的判据本来就不止一个能力。
   */
  public static UserPermission noneFor(long userId, LocalDateTime now) {
    UserPermission permission = new UserPermission();
    permission.setUserId(userId);
    permission.setCanText(false);
    permission.setCanImage(false);
    permission.setCanVision(false);
    permission.setCanSpeech(false);
    permission.setUpdatedAt(now);
    return permission;
  }

  public static UserPermission allFor(long userId, LocalDateTime now) {
    UserPermission permission = noneFor(userId, now);
    permission.setCanText(true);
    permission.setCanImage(true);
    permission.setCanVision(true);
    permission.setCanSpeech(true);
    return permission;
  }

  public Permissions toPermissions() {
    return new Permissions(canText, canImage, canVision, canSpeech);
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public boolean isCanText() {
    return canText;
  }

  public void setCanText(boolean canText) {
    this.canText = canText;
  }

  public boolean isCanImage() {
    return canImage;
  }

  public void setCanImage(boolean canImage) {
    this.canImage = canImage;
  }

  public boolean isCanVision() {
    return canVision;
  }

  public void setCanVision(boolean canVision) {
    this.canVision = canVision;
  }

  public boolean isCanSpeech() {
    return canSpeech;
  }

  public void setCanSpeech(boolean canSpeech) {
    this.canSpeech = canSpeech;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }
}
