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
    /** `ACTIVE` / `DISABLED`。★ 这一屏要一眼看出"哪几个已经被停过"——见下方 `of` 里的归一 */
    String status,
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
        // ★ 归一成两个值之一再出去：这一列是后来才加的，老数据可能是 null 或空串，
        //   而界面上的判据只有"是不是停用"这一条——让前端自己去猜 null 是什么意思，
        //   就是把这个判断second份实现（它们必然会开始不一样）。
        //   认不出的一律当 `ACTIVE`，与 `User.isActive` 同一条口径。
        User.isActive(user) ? User.STATUS_ACTIVE : User.STATUS_DISABLED,
        Times.iso(user.getCreatedAt()),
        // ★ 从没登录过就是 null（不是空串）：界面上那一格要显示"还没来过"，
        //   而这与"登录时间是一串空"是两件事
        Times.iso(user.getLastLoginAt()),
        permissions);
  }
}
