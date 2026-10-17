package com.onceuponme.api.auth.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.auth.PermissionRequest;

/** 权限申请。★ 与 `sms_send_log` 一样是**只增**的账：批过、拒过的都不删（见那张表的注释） */
@Mapper
public interface PermissionRequestMapper extends BaseMapper<PermissionRequest> {}
