package com.onceuponme.api.auth;

/**
 * 四个能力开关。★ 它就是发给界面看的形状，字段名与前端那个
 * {@code AuthUser.permissions} 一致（{@code text}/{@code image}/{@code vision}/{@code speech}）。
 *
 * <p>★ 用这四个词而不是"套餐名"（basic/pro）：套餐是"我们替你想好的组合"，
 * 而这四件事在这个产品里是**四个真的不同的能力**（写故事、画插画、核对形象、朗读），
 * 它们的成本、耗时、失败方式全不一样。合成一个档位之后，界面上那句
 * 「当前用户没有权限」就没法说清是缺哪一件，管理员也没法只开一半。
 */
public record Permissions(boolean text, boolean image, boolean vision, boolean speech) {

  public static Permissions none() {
    return new Permissions(false, false, false, false);
  }

  public static Permissions all() {
    return new Permissions(true, true, true, true);
  }

  // ★ 这里原来有一个 `empty()`，给"一样都没勾就提交"那条校验用。
  //   2026-10-17 申请改成"四项一起开通"之后它没有调用方了，所以删掉——
  //   留着一个没人用的方法，下一个人会以为某处还在靠它挡着什么。
}
