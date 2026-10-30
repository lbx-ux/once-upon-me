package com.onceuponme.api.credit;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 额度账本的一行：一次授予（+）或者一次扣减（-）。
 *
 * <p>★ 只追加，不改、不删。这是"这个人的额度是怎么变成现在这个数的"唯一答案，
 * 也是退款判据：{@link #REASON_REFUND} 与 {@link #REASON_CONSUME} 按同一个书号
 * 各自求和，两个合计对齐（扣过几次就能退几次，合计不超过扣的）。
 *
 * <p>★ 列名是 {@code ref_no} 而不是 {@code ref}：后者在 SQL 方言里是一个太容易
 * 撞上保留字的短词，而这类问题只在某一侧（H2 或 MySQL）出现——正是这个仓库
 * 已经为 {@code chosen} 那一列付过一次学费的形状。
 */
@TableName("book_credits")
public class BookCredit {

  /** 后台授予 / 迁移 / 演示账号。三种都不是用户动作，但都要能分开数 */
  public static final String REASON_GRANT = "grant";

  /** 兑换码核销 */
  public static final String REASON_REDEEM = "redeem";

  /** 画一本书。{@code refNo} 是书号 */
  public static final String REASON_CONSUME = "consume";

  /** 退一本。只在"一页都没画出来"时出现 */
  public static final String REASON_REFUND = "refund";

  @TableId(type = IdType.AUTO)
  private Long id;

  private Long userId;

  /** 正数是授予，负数是扣减。★ 不存"余额"，余额在 {@link CreditAccount} */
  private int delta;

  /** 见上面那四个常量。★ 认不出的值一律按"别的来源"显示，不参与任何判据 */
  private String reason;

  /** 这一笔对应什么：书号 / 兑换码批次 / 订单号。可空（管理员的纯赠送没有对象） */
  private String refNo;

  /** 给人看的一行说明（兑换码尾号、批次名…）。★ 不放任何密钥或完整码 */
  private String note;

  private LocalDateTime createdAt;

  public static BookCredit of(
      long userId, int delta, String reason, String refNo, String note, LocalDateTime now) {
    BookCredit credit = new BookCredit();
    credit.setUserId(userId);
    credit.setDelta(delta);
    credit.setReason(reason);
    credit.setRefNo(refNo);
    credit.setNote(note == null ? "" : note);
    credit.setCreatedAt(now);
    return credit;
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

  public int getDelta() {
    return delta;
  }

  public void setDelta(int delta) {
    this.delta = delta;
  }

  public String getReason() {
    return reason;
  }

  public void setReason(String reason) {
    this.reason = reason;
  }

  public String getRefNo() {
    return refNo;
  }

  public void setRefNo(String refNo) {
    this.refNo = refNo;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }
}
