package com.onceuponme.api.auth.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.auth.User;

/**
 * 账号表。★ 一张表就一个查询条件（{@code account}），但**不写自定义 SQL**：
 * {@code selectOne(Wrappers.lambdaQuery(User.class).eq(User::getAccount, account))}
 * 已经够用，而手写一句 SQL 就多一处"改字段名时忘了改字符串"的地方。
 */
@Mapper
public interface UserMapper extends BaseMapper<User> {}
