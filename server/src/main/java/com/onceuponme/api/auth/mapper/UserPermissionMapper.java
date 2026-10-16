package com.onceuponme.api.auth.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.auth.UserPermission;

/** 权限表。一人一行，主键就是 user_id（{@code IdType.INPUT}），所以没有自增这回事。 */
@Mapper
public interface UserPermissionMapper extends BaseMapper<UserPermission> {}
