package com.onceuponme.api.credit.mapper;

import org.apache.ibatis.annotations.Mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.onceuponme.api.credit.BookCredit;

/** 额度账本。只追加，见 {@link BookCredit} 类注释 */
@Mapper
public interface BookCreditMapper extends BaseMapper<BookCredit> {}
