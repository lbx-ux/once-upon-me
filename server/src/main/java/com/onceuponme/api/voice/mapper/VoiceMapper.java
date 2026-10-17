package com.onceuponme.api.voice.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.voice.Voice;

/** 音色记录。★ 与别的表不一样：这是**用户自己的东西**，所以它会真的被删（见 `VoiceService#forget`） */
@Mapper
public interface VoiceMapper extends BaseMapper<Voice> {}
