package com.onceuponme.api.credit.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.credit.RedeemCode;

/** 兑换码。主键是明文码的 HMAC，见 {@link RedeemCode} 类注释 */
@Mapper
public interface RedeemCodeMapper extends BaseMapper<RedeemCode> {}
