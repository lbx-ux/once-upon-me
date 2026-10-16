package com.onceuponme.api.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.admin.dto.AdminOverview;
import com.onceuponme.api.admin.dto.AdminUserRow;
import com.onceuponme.api.admin.dto.PermissionPatch;
import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.CurrentSession;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 管理页那两个接口。★ 两道闸，都在服务端：
 * 一条是 {@code X-Internal-Token}（BFF 才有的，见 {@code InternalTokenFilter}），
 * 另一条是这里的 {@code requireAdmin}（票里的 role）。
 *
 * <p>★ 为什么还要第二道：第一道只管"这个请求来自 BFF"，而 BFF 是所有登录用户
 * 共用的一个人。没有第二道的话，任何登录进来的人手打一个
 * {@code PATCH /api/admin/users/3/permissions}（BFF 会老老实实替他转发）就能给自己开权限。
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

  private final AdminService admin;
  private final CurrentSession current;
  private final AuthService auth;

  public AdminController(AdminService admin, CurrentSession current, AuthService auth) {
    this.admin = admin;
    this.current = current;
    this.auth = auth;
  }

  @GetMapping("/users")
  public AdminOverview users(HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.overview();
  }

  @PatchMapping("/users/{userId}/permissions")
  public AdminUserRow updatePermissions(
      @PathVariable long userId, @RequestBody PermissionPatch body, HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.updatePermissions(userId, body.toPermissions());
  }

  /**
   * 管理员 + **票没过期**。
   *
   * <p>★ 第二道不能省：`requireAdmin` 只看票里的角色，而票可能是这个人**改密码之前**
   * 签发的。管理动作是这一轮权限最大的一类，它必须走与 `/me` 同一条新鲜度判据。
   */
  private void requireAdminFresh(HttpServletRequest request) {
    auth.requireUser(current.requireAdmin(request));
  }
}
