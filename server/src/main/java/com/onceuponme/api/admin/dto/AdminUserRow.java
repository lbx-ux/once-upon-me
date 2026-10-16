package com.onceuponme.api.admin.dto;

import com.onceuponme.api.auth.Permissions;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;

/**
 * 管理页上一行：谁、什么时候来的、四个开关现在什么样。
 *
 * <p>★ 比 {@code UserView} 多两个字段（{@code role} 与 {@code lastLoginAt}），
 * 因为它们只有管理员看得到、也只在这一屏有用：权限页上要一眼看出
 * "哪几个是管理员""哪几个注册了但从没进来过"。
 * 复用一个类型会把这些字段塞进每个人的会话响应里，而那些字段对本人毫无意义。
 */
public record AdminUserRow(
    String userId,
    String account,
    String phone,
    String nickname,
    String avatar,
    String role,
    String createdAt,
    String lastLoginAt,
    Permissions permissions) {

  public static AdminUserRow of(User user, Permissions permissions) {
    return new AdminUserRow(
        String.valueOf(user.getId()),
        user.getAccount(),
        user.getPhone(),
        user.getNickname(),
        user.getAvatar(),
        user.getRole(),
        Times.iso(user.getCreatedAt()),
        // ★ 从没登录过就是 null（不是空串）：界面上那一格要显示"还没来过"，
        //   而这与"登录时间是一串空"是两件事
        Times.iso(user.getLastLoginAt()),
        permissions);
  }
}
