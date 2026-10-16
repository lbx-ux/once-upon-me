package com.onceuponme.api.auth.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.auth.SmsCode;

/** 待核验的验证码。一人一行，主键就是手机号。 */
@Mapper
public interface SmsCodeMapper extends BaseMapper<SmsCode> {}
