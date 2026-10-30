package com.onceuponme.api.credit;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.CurrentSession;
import com.onceuponme.api.auth.JwtService;
import com.onceuponme.api.credit.dto.AdminCreditView;
import com.onceuponme.api.credit.dto.BalanceView;
import com.onceuponme.api.credit.dto.CodeBatchResult;
import com.onceuponme.api.credit.dto.CodeBatchSpec;
import com.onceuponme.api.support.ApiException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 管理页的「额度与兑换码」：总账、生成一批码、给某个人补发。
 *
 * <p>★ 三道闸与 `/api/admin/users` 一字不差：内部令牌（过滤器）、票里的角色
 * （{@link CurrentSession#requireAdmin}）、以及"角色是此刻的吗"
 * （{@link AuthService#requireUser}）。少任何一道，一个刚被停用的管理员
 * 都能继续发钱——而发钱是这个站里权限最大的动作之一。
 */
@RestController
@RequestMapping("/api/admin/credits")
public class CreditAdminController {

  private final CreditAdminService admin;
  private final CurrentSession current;
  private final AuthService auth;

  public CreditAdminController(CreditAdminService admin, CurrentSession current, AuthService auth) {
    this.admin = admin;
    this.current = current;
    this.auth = auth;
  }

  /** 总账：余额合计、码的发放与核销、最近订单、批次、账本差额 */
  @GetMapping
  public AdminCreditView overview(HttpServletRequest request) {
    requireAdminFresh(request);
    return admin.overview();
  }

  /**
   * 生成一批码。★ 响应里的 {@code codes} 是明文，只出现这一次。
   * 前端必须当场渲染成可下载的 CSV——刷新一下就没有了，库里查不回来。
   */
  @PostMapping("/codes")
  public CodeBatchResult issue(@RequestBody CodeBatchSpec body, HttpServletRequest request) {
    JwtService.Session session = requireAdminFresh(request);
    return admin.issue(body);
  }

  /** 给某个人补几本。★ 走账本（reason=grant），不是直接改余额 */
  @PostMapping("/grant")
  public BalanceView grant(@RequestBody GrantBody body, HttpServletRequest request) {
    JwtService.Session session = requireAdminFresh(request);
    if (body == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    if (body.userId() <= 0) throw ApiException.badRequest("bad-user", "要给哪个账号补？");
    int balance = admin.grantTo(body.userId(), body.books(), body.note(), session.userId());
    return new BalanceView(balance);
  }

  public record GrantBody(long userId, int books, String note) {}

  private JwtService.Session requireAdminFresh(HttpServletRequest request) {
    JwtService.Session session = current.requireAdmin(request);
    auth.requireUser(session);
    return session;
  }
}
