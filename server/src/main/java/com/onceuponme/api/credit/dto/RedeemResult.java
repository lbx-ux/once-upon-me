package com.onceuponme.api.credit.dto;

/** 兑换成功：换到几本、现在还剩几本、这张码的后四位（给用户核对） */
public record RedeemResult(int books, int balance, String codeTail) {}
