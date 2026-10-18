package com.onceuponme.api.auth.dto;

import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;

/**
 * 一个人对外的样子。★ 字段名与前端那个 {@code AuthUser}
 * （{@code src/lib/auth/state.ts}）逐字对齐，BFF 因此不需要一个翻译层——
 * 而"两边各有一份字段名映射"正是那种改一边忘一边、症状是"昵称显示了但头像没有"的地方。
 *
 * <p>★ 这里**没有** {@code passwordHash}，也不会有：出参类型与实体分开写，
 * 图的就是"顺手把实体返回去"这件事在类型上不成立。
 * 前端那个 {@code parseUser} 读到多余字段会原样丢掉，但丢在网络上已经晚了。
 *
 * <p>★ 2026-10-18：{@code permissions}（四个布尔）→ {@code allowed}（一位）。
 * 界面上因此只剩一个问题"这个人能不能创作"，而"站里配没配某一项模型"
 * 是另一个事实——它在 BFF 那一层从 {@code serverEnv()} 算出来（{@code configured}），
 * 后端根本不知道有没有配 TTS。两件事在响应里仍然分开，见 {@code /api/auth/me}。
 */
public record UserView(
    String userId,
    String account,
    String phone,
    String nickname,
    String avatar,
    String role,
    String createdAt,
    boolean allowed) {

  public static UserView of(User user, boolean allowed) {
    return new UserView(
        // ★ 转成字符串：前端的 id 是 string，而 JS 的 number 装不下 BIGINT 的全精度。
        //   现在 id 是一位数，但"等它长大了再改类型"是一次没人会记得的迁移
        String.valueOf(user.getId()),
        user.getAccount(),
        user.getPhone(),
        user.getNickname(),
        user.getAvatar(),
        user.getRole(),
        Times.iso(user.getCreatedAt()),
        allowed);
  }

  /** 出参里权限一定在，所以这里给一个"还没查"的默认——只有 {@code me()} 那条路会用到 */
  public static UserView of(User user) {
    return of(user, false);
  }
}
