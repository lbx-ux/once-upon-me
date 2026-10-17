package com.onceuponme.api.auth;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.admin.PermissionRequestService;
import com.onceuponme.api.admin.dto.AdminRequestRow;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 权限申请里**用户那一半**：提一条、看看自己那条还在不在。
 *
 * <p>★ 它替掉的是原来那句"发邮件到 2953997419@qq.com"（用户 2026-10-17）。
 * 那个邮箱仍然印在帮助里，但现在只在"申请被拒之后想问一句为什么"时才用得上——
 * 常规路径点一下按钮就完了。
 *
 * <p>★ 为什么 `GET` 也要有一个：界面上要显示「你已经申请过了，等站长处理」。
 * 没有它的话，一个人提完会以为没提交成功，然后再提一次——而那正是
 * `PermissionRequestService#submit` 要防的那种堆积。
 */
@RestController
@RequestMapping("/api/permission-requests")
public class PermissionRequestController {

  private final PermissionRequestService requests;
  private final CurrentSession current;
  private final AuthService auth;

  public PermissionRequestController(
      PermissionRequestService requests, CurrentSession current, AuthService auth) {
    this.requests = requests;
    this.current = current;
    this.auth = auth;
  }

  /** 我那条待处理的。**没有就是 `null`**（不是 404）：界面上"没申请过"是正常状态 */
  @GetMapping("/mine")
  public MineBody mine(HttpServletRequest request) {
    User user = auth.requireUser(current.require(request));
    return new MineBody(requests.minePending(user.getId()));
  }

  /**
   * 「我那条」的响应体。
   *
   * <p>★ 为什么是一个 record 而不是 {@code Map.of("request", …)}：**`Map.of` 不接受 null 值**，
   * 而"没有待处理的申请"正是 `null`——第一版就是这么写的，于是这个接口在"没申请过"
   * 这个**最常见**的情形下直接 500（`PermissionRequestIntegrationTest#mineReportsPendingState`
   * 第一版红在这儿）。record 的字段可以是 null，序列化出来就是 `{"request": null}`。
   *
   * <p>★ 而不直接返回裸 `null`：一个裸 null 响应体在 `fetch` 那边与"空响应"是同一种东西，
   * 前端得靠 `res.status` 去猜。包一层没有歧义。
   */
  public record MineBody(AdminRequestRow request) {}

  /** 提一条。★ 已经有一条待处理时是**改那一条**，不是又插一条（见 service 的类注释） */
  @PostMapping
  public AdminRequestRow submit(@RequestBody SubmitBody body, HttpServletRequest request) {
    User user = auth.requireUser(current.require(request));
    requests.submit(user.getId(), body.note());
    return requests.minePending(user.getId());
  }

  /**
   * 申请的内容：**只剩一句说明**。
   *
   * <p>★ 原来这里有四个 boolean（让申请人自己勾要哪几项）。2026-10-17 去掉：
   * 申请一律四项一起开通（见 {@code PermissionRequestService#submit}），
   * 所以"你要哪几项"这个问题不该再问一遍——问出来的那个答案站长也不看，
   * 而界面上那四个复选框会让人以为自己能挑。
   */
  public record SubmitBody(String note) {}
}
