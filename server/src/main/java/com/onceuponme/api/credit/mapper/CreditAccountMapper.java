package com.onceuponme.api.credit.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.credit.CreditAccount;

/**
 * 额度余额。一人一行，主键就是 user_id（{@code IdType.INPUT}）。
 *
 * <p>★ 扣减与授予都不走这个接口的默认方法，而是在 {@code CreditService} 里用
 * {@code UpdateWrapper} 写"带条件的自增/自减"：
 * {@code SET balance = balance - n WHERE balance >= n}。这是这一整张表存在的理由
 * （见 {@link CreditAccount} 类注释），把它写成"读出来、减一、写回去"就白留了。
 *
 * <p>★ 唯一的例外是 {@link #lockByUserId}：退款要先把"这个人的账本求和"与"写入"
 * 串成一件不可分割的事，而求和不是一条 UPDATE，条件更新那条路子用不上。
 * 这一句只取行锁、不读值（返回值刻意不用）。两者都认这一句：
 * H2 的 {@code MVStore} 与 MySQL 的 InnoDB 都在 {@code FOR UPDATE} 上锁行。
 */
@Mapper
public interface CreditAccountMapper extends BaseMapper<CreditAccount> {

  /** 锁住这个人的余额行，直到事务结束。没这行就回 null（调用方先 {@code ensureAccount}） */
  @Select("SELECT user_id FROM credit_accounts WHERE user_id = #{userId} FOR UPDATE")
  Long lockByUserId(@Param("userId") long userId);
}
