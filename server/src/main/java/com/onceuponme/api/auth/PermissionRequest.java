package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一条权限申请。
 *
 * <p>★ 它替掉的是"发邮件给站长"（用户 2026-10-17 的原话：「现在是用户要发邮件，
 * 可以修改一下……然后管理端就接收到申请，这也比发邮件好一点，
 * 管理端也可以清楚的看到是谁发送的请求」）。邮件那条路的三个毛病它一次修掉：
 * 站长不知道发信人是不是站上的人、申请散在收件箱里、批完还得手动去管理页勾。
 *
 * <p>★ 四个 `wants*` 的**列名照抄 {@code user_permissions}**，批准的动作就是把这四列
 * 原样搬过去。名字一样，那次搬运才是一行直白的赋值。
 *
 * <p>★ `status` 三态而不是"有就是没处理"：**拒掉的那条要留着**。
 * 它是"这个人申请过、被拒了"的唯一记录——看不见已处理的申请，
 * 申请人会反复提同一件事，站长会反复拒同一件事。
 */
@TableName("permission_requests")
public class PermissionRequest {

  public static final String PENDING = "PENDING";
  public static final String APPROVED = "APPROVED";
  public static final String REJECTED = "REJECTED";

  /** 说明那一栏的长度上限。★ 与 `schema.sql` 的 `VARCHAR(500)` 同值，改要一起改 */
  public static final int NOTE_MAX = 500;

  @TableId(type = IdType.AUTO)
  private Long id;

  private Long userId;

  private boolean wantsText;
  private boolean wantsImage;
  private boolean wantsVision;
  private boolean wantsSpeech;

  private String note;
  private String status;
  private LocalDateTime createdAt;
  private LocalDateTime decidedAt;
  private Long decidedBy;

  /** 这个人要的那几个能力。★ 与 `Permissions` 同一支类型，因为它本来就是同一件事 */
  public Permissions wants() {
    return new Permissions(wantsText, wantsImage, wantsVision, wantsSpeech);
  }

  /** 一样都没勾。★ 这种申请**不许提交**：批准它等于什么都没发生，见 `AuthService` 那条校验 */
  public boolean asksForNothing() {
    return !wantsText && !wantsImage && !wantsVision && !wantsSpeech;
  }

  public boolean isPending() {
    return PENDING.equals(status);
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public boolean isWantsText() {
    return wantsText;
  }

  public void setWantsText(boolean wantsText) {
    this.wantsText = wantsText;
  }

  public boolean isWantsImage() {
    return wantsImage;
  }

  public void setWantsImage(boolean wantsImage) {
    this.wantsImage = wantsImage;
  }

  public boolean isWantsVision() {
    return wantsVision;
  }

  public void setWantsVision(boolean wantsVision) {
    this.wantsVision = wantsVision;
  }

  public boolean isWantsSpeech() {
    return wantsSpeech;
  }

  public void setWantsSpeech(boolean wantsSpeech) {
    this.wantsSpeech = wantsSpeech;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getDecidedAt() {
    return decidedAt;
  }

  public void setDecidedAt(LocalDateTime decidedAt) {
    this.decidedAt = decidedAt;
  }

  public Long getDecidedBy() {
    return decidedBy;
  }

  public void setDecidedBy(Long decidedBy) {
    this.decidedBy = decidedBy;
  }
}
