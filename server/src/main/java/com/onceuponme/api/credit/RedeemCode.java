package com.onceuponme.api.credit;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一张兑换码。一码一行。
 *
 * <p>★ <b>库里没有明文码，只有 HMAC。</b>兑换码就是钱：库被读走，明文就等于被人拿走了。
 * 所以 {@code codeHash} 是主键，而 {@code codeTail} 只存后四位——它的唯一用途是
 * 客服对账时确认"这张码是不是你说的那张"，而不是把码还原出来。
 * 代价说清楚：<b>码丢了只能补发，不能查回</b>。这是对的。
 *
 * <p>★ 核销是"一条带条件的 UPDATE"，不是"先查再写"：
 * {@code UPDATE redeem_codes SET redeemed_by=? WHERE code_hash=? AND redeemed_by IS NULL}。
 * 先查再写在两个人同时提交同一个码时会让两边都看到"还没用过"，于是发两份额度。
 * 这是兑换码这一类功能最典型的坏法，判据在 {@code CreditFlowIntegrationTest}。
 *
 * <p>★ 过期判据放在 SQL 的 WHERE 里，与"没用过"同一个条件：两条都要成立才核销得掉。
 * 放到 Java 里先判一次的话，并发下那一次判断会在 UPDATE 之前作废。
 */
@TableName("redeem_codes")
public class RedeemCode {

  /** 主键：明文码的 HMAC（十六进制，64 字符）。★ 见类上第一段 */
  @TableId(type = IdType.INPUT)
  private String codeHash;

  /** 明文码的后四位。★ 只用于对账，不足以还原整张码 */
  private String codeTail;

  /** 这张码换几本 */
  private int books;

  /** 批次名（哪个机构 / 哪次活动）。同一批的码一起生成、一起导出 */
  private String batch;

  /** 这一批的说明（给站长自己看）。★ 不放任何个人信息 */
  private String note;

  /** 过期时刻。空 = 不过期 */
  private LocalDateTime expiresAt;

  /** 谁核销的。空 = 还没被核销 */
  private Long redeemedBy;

  private LocalDateTime redeemedAt;

  private LocalDateTime createdAt;

  public static RedeemCode of(
      String codeHash,
      String codeTail,
      int books,
      String batch,
      String note,
      LocalDateTime expiresAt,
      LocalDateTime now) {
    RedeemCode code = new RedeemCode();
    code.setCodeHash(codeHash);
    code.setCodeTail(codeTail);
    code.setBooks(books);
    code.setBatch(batch);
    code.setNote(note == null ? "" : note);
    code.setExpiresAt(expiresAt);
    code.setCreatedAt(now);
    return code;
  }

  public String getCodeHash() {
    return codeHash;
  }

  public void setCodeHash(String codeHash) {
    this.codeHash = codeHash;
  }

  public String getCodeTail() {
    return codeTail;
  }

  public void setCodeTail(String codeTail) {
    this.codeTail = codeTail;
  }

  public int getBooks() {
    return books;
  }

  public void setBooks(int books) {
    this.books = books;
  }

  public String getBatch() {
    return batch;
  }

  public void setBatch(String batch) {
    this.batch = batch;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
  }

  public LocalDateTime getExpiresAt() {
    return expiresAt;
  }

  public void setExpiresAt(LocalDateTime expiresAt) {
    this.expiresAt = expiresAt;
  }

  public Long getRedeemedBy() {
    return redeemedBy;
  }

  public void setRedeemedBy(Long redeemedBy) {
    this.redeemedBy = redeemedBy;
  }

  public LocalDateTime getRedeemedAt() {
    return redeemedAt;
  }

  public void setRedeemedAt(LocalDateTime redeemedAt) {
    this.redeemedAt = redeemedAt;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }
}
