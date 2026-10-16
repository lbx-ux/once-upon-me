package com.onceuponme.api.auth.mapper;

import java.time.LocalDateTime;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.auth.SmsSendLog;

/**
 * 验证码发送记录。★ 三个 {@code count} 各自对应频控的一层，
 * 写成一个通用方法会变成"传一个窗口大小进去"——而三层窗口的单位根本不同
 * （秒 / 小时 / 天），参数化的那天起就有人会把 {@code 3600} 写成 {@code 60}。
 */
@Mapper
public interface SmsSendLogMapper extends BaseMapper<SmsSendLog> {

  @Select("SELECT COUNT(*) FROM sms_send_log WHERE phone = #{phone} AND sent_at >= #{since}")
  long countByPhoneSince(@Param("phone") String phone, @Param("since") LocalDateTime since);

  @Select("SELECT COUNT(*) FROM sms_send_log WHERE ip = #{ip} AND sent_at >= #{since}")
  long countByIpSince(@Param("ip") String ip, @Param("since") LocalDateTime since);

  @Select("SELECT COUNT(*) FROM sms_send_log WHERE sent_at >= #{since}")
  long countAllSince(@Param("since") LocalDateTime since);
}
