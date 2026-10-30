package com.onceuponme.api.credit.dto;

import java.util.List;

import com.onceuponme.api.auth.Times;
import com.onceuponme.api.credit.BookCredit;

/** 一个人自己的额度：还剩几本 + 最近几十笔流水。 */
public record CreditView(int balance, List<CreditEntry> entries) {

  public static CreditView of(int balance, List<BookCredit> rows) {
    return new CreditView(
        balance,
        rows.stream()
            .map(
                row ->
                    new CreditEntry(
                        String.valueOf(row.getId()),
                        row.getDelta(),
                        row.getReason(),
                        row.getRefNo(),
                        row.getNote(),
                        Times.iso(row.getCreatedAt())))
            .toList());
  }
}
