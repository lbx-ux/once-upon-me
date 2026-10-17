package com.onceuponme.api.admin;

import org.springframework.http.ResponseEntity;
import java.util.List;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.admin.dto.AdminOverview;
import com.onceuponme.api.admin.dto.AdminRequestRow;
import com.onceuponme.api.admin.dto.AdminUserRow;
import com.onceuponme.api.admin.dto.PermissionPatch;
import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.CurrentSession;
import com.onceuponme.api.auth.JwtService;

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
  private final PermissionRequestService requestService;
  private final CurrentSession current;
  private final AuthService auth;

  public AdminController(
      AdminService admin,
      PermissionRequestService requestService,
      CurrentSession current,
      AuthService auth) {
    this.admin = admin;
    this.requestService = requestService;
    this.current = current;
    this.auth = auth;
  }

  @GetMapping("/users")
  public AdminOverview users(HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.overview();
  }

  /**
   * 「这个人此刻是管理员吗」——给 BFF 里那些**只在 Next 一侧存在**的管理资源用
   * （现在是模型配置：它写的是磁盘上那份文件，Java 碰不到它）。
   *
   * <p>★ 这个端点**不返回任何数据**，它存在的唯一作用是让那句判断有一个
   * 服务端的出处。没有它的话，Next 那一层只能自己看票里的 `role`——而票里的角色是
   * **签发时**的：一个刚被停用、或者密码刚被改过的人，旧票照样说他还是管理员。
   * 那两条判据（角色 + 新鲜度）都只写在 {@link #requireAdminFresh} 里，所以
   * 需要它的人应该来问，而不是在别处再实现一遍。
   *
   * <p>★ 它**不是**"登录了就算过"的轻量版：走的是与改权限同一道闸。
   * 拿它当"随便探一下"的接口是误用——那些资源本身就该先过这一关。
   */
  @GetMapping("/check")
  public CheckBody check(HttpServletRequest request) {
    requireAdminFresh(request);
    return new CheckBody(true);
  }

  public record CheckBody(boolean admin) {}

  @PatchMapping("/users/{userId}/permissions")
  public AdminUserRow updatePermissions(
      @PathVariable long userId, @RequestBody PermissionPatch body, HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.updatePermissions(userId, body.toPermissions());
  }

  /* ── 建号 / 停号 / 删号 / 重置别人的密码（2026-10-17，用户要的）─────────────
   *
   * ★ 四条都走同一个 `requireAdminFresh`，一条都不例外：它们是这一轮权限最大的动作，
   *   而"管理员"这件事必须按**此刻**判——一张改密码之前签发的票不该还能改别人的口令。
   */

  /** 建号。四个能力一律不开（见 `AdminService#createUser`） */
  @PostMapping("/users")
  public AdminUserRow createUser(@RequestBody CreateUserBody body, HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.createUser(body.account(), body.password());
  }

  /** 停号 / 复号。★ 停用对**已经登着的会话**也是即时生效的（见 `AuthService#requireUser`） */
  @PatchMapping("/users/{userId}/status")
  public AdminUserRow updateStatus(
      @PathVariable long userId, @RequestBody StatusBody body, HttpServletRequest request) {
    JwtService.Session session = requireAdminFresh(request);
    return admin.setStatus(userId, body.status(), session.userId());
  }

  /**
   * 删号。
   *
   * ★ 用 `DELETE` 而不是 `POST .../delete`：这一条是真的删（一次不可逆的写），
   *   而"HTTP 动词与后果对得上"是这一层唯一还剩下的自我说明。
   * ★ 它**不会**带走这个人做过的绘本（此刻作品还挂不到人身上），
   *   理由写在 `AdminService#deleteUser` 上。
   */
  @DeleteMapping("/users/{userId}")
  public ResponseEntity<Void> deleteUser(@PathVariable long userId, HttpServletRequest request) {
    JwtService.Session session = requireAdminFresh(request);
    admin.deleteUser(userId, session.userId());
    return ResponseEntity.noContent().build();
  }

  /**
   * 替一个人重置密码。
   *
   * ★ 口令**从请求体进来、不被回显**：响应里只有这个人现在的样子。
   *   "服务端生成一个口令再告诉你"那条路要把它写进某处才能被读到，
   *   而这个仓库在密钥与录音样本上已经两次选了"没有一份要删的副本"。
   */
  @PatchMapping("/users/{userId}/password")
  public AdminUserRow resetPassword(
      @PathVariable long userId, @RequestBody ResetPasswordBody body, HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.resetPassword(userId, body.password());
  }

  /* ── 权限申请（2026-10-17）────────────────────────────────────────────────
   *
   * ★ 它与 `/users` **分开成两个端点**，而不是并进 `AdminOverview` 里一起返回：
   *   批完一条要刷新的是"这一列申请"，不是"整张用户表"。并在一起的话，
   *   每批一条就把整张表重新拉一遍（顺便把别人正在改的 checkbox 覆盖掉）。
   */

  /** 全部申请，待处理在前 */
  @GetMapping("/requests")
  public List<AdminRequestRow> requests(HttpServletRequest request) {
    requireAdminFresh(request);
    return requestService.list();
  }

  /**
   * 批 / 拒一条。
   *
   * ★ 批准 = **把那几个能力并到他现有的权限上**（不是覆盖），理由写在
   *   `PermissionRequestService#decide` 上：一个已有文本权限、这次只申请图像的人，
   *   覆盖式批准会把他已有的那一项关掉。
   */
  @PatchMapping("/requests/{requestId}")
  public AdminRequestRow decideRequest(
      @PathVariable long requestId, @RequestBody DecideBody body, HttpServletRequest request) {
    JwtService.Session session = requireAdminFresh(request);
    return requestService.decide(requestId, body.approve(), session.userId());
  }

  public record DecideBody(boolean approve) {}

  /** 建号的请求体。两个字段都是明文进来的口令，**不进日志** */
  public record CreateUserBody(String account, String password) {}

  public record StatusBody(String status) {}

  public record ResetPasswordBody(String password) {}

  /**
   * 管理员 + **票没过期**。返回值给需要"动手的是谁"的那两条（停号与删号）用。
   *
   * <p>★ 第二道不能省：`requireAdmin` 只看票里的角色，而票可能是这个人**改密码之前**
   * 签发的。管理动作是这一轮权限最大的一类，它必须走与 `/me` 同一条新鲜度判据。
   */
  private JwtService.Session requireAdminFresh(HttpServletRequest request) {
    JwtService.Session session = current.requireAdmin(request);
    auth.requireUser(session);
    return session;
  }
}
