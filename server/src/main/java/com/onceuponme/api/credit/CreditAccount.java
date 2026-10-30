package com.onceuponme.api.credit;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一个人现在还剩几本创作额度。一人一行。
 *
 * <p>★ <b>它是账本的缓存，不是账本本身。</b>真正可对的是 {@code book_credits}：
 * 那边的 {@code SUM(delta)} 必须永远等于这里的 {@code balance}。留这一列只为一件事：
 * <b>扣减要能原子地判"够不够"</b>——
 * {@code UPDATE credit_accounts SET balance = balance - 1 WHERE user_id = ? AND balance >= 1}
 * 一条语句就同时完成了"读、判、写"，而"先 SUM 再 INSERT"在两个人同时点的时候
 * 会让余额变成 -1。
 *
 * <p>★ 为什么余额不直接从账本 SUM 出来：那样每次扣减都得先算一遍总和再决定写不写，
 * 中间有一个窗口。这个窗口在两个标签页同时点「就按这个画」时真的会撞上。
 * 而多出的这一列是可以被对账的（{@code CreditService#driftOf} 读的就是两边之差），
 * 所以它没有把"账本可对"这件事弄丢。
 *
 * <p>★ 缺行 = 0 本，不是"无限"。这一条与权限那一位的"缺行 = 有"刻意相反：
 * 权限缺行是"没被收回过"，额度缺行是"还没拿到过任何一本"。两种默认值的方向不同，
 * 因为它们回答的是两个问题。
 */
@TableName("credit_accounts")
public class CreditAccount {

  @TableId(type = IdType.INPUT)
  private Long userId;

  /** 还剩几本。★ 它不该是负数：扣减那条 UPDATE 带着 {@code balance >= n} */
  private int balance;

  private LocalDateTime updatedAt;

  public static CreditAccount of(long userId, int balance, LocalDateTime now) {
    CreditAccount account = new CreditAccount();
    account.setUserId(userId);
    account.setBalance(balance);
    account.setUpdatedAt(now);
    return account;
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public int getBalance() {
    return balance;
  }

  public void setBalance(int balance) {
    this.balance = balance;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }
}
