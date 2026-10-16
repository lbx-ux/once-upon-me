package com.onceuponme.api.auth;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.auth.dto.AvatarRequest;
import com.onceuponme.api.auth.dto.ChangePasswordRequest;
import com.onceuponme.api.auth.dto.CodeVerdict;
import com.onceuponme.api.auth.dto.IssuedSession;
import com.onceuponme.api.auth.dto.LoginRequest;
import com.onceuponme.api.auth.dto.NicknameRequest;
import com.onceuponme.api.auth.dto.SendCodeRequest;
import com.onceuponme.api.auth.dto.SendCodeResult;
import com.onceuponme.api.auth.dto.SetPasswordRequest;
import com.onceuponme.api.auth.dto.UserView;
import com.onceuponme.api.auth.dto.VerifyCodeRequest;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

/**
 * 登录与账号。**每一个接口都由 BFF（Next 的 {@code /api/auth/*}）转发**，
 * 浏览器从不直接打这里——它连不到（Java 只听回环），也拿不到那张票
 * （票在 httpOnly cookie 里，由 BFF 放进 {@code Authorization} 头）。
 *
 * <p>★ 这一层刻意**只有转发**：真正的判断在 {@link AuthService}，
 * Controller 里不出现任何一条 if——它是"接口长什么样"，不是"规则是什么"。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private final AuthService auth;
  private final CurrentSession current;

  public AuthController(AuthService auth, CurrentSession current) {
    this.auth = auth;
    this.current = current;
  }

  /**
   * 发验证码。★ 频控要看 IP，而 Java 看到的是 Nginx（127.0.0.1），
   * 所以真实来源只能从 {@code X-Forwarded-For} 读（Nginx 配了它）。
   * 能伪造这个头的人只有"已经能连到 8080 的人"，而那是回环——
   * 也就是说这条依赖的成立前提是"Java 不对外"。这一条写在 README §五 里。
   */
  @PostMapping("/sms/send")
  public SendCodeResult sendCode(@Valid @RequestBody SendCodeRequest body, HttpServletRequest request) {
    return auth.sendCode(body.account(), ClientIp.of(request));
  }

  @PostMapping("/sms/verify")
  public CodeVerdict verifyCode(@Valid @RequestBody VerifyCodeRequest body) {
    return auth.verifyCode(body.account(), body.code());
  }

  @PostMapping("/password")
  public IssuedSession setPassword(@Valid @RequestBody SetPasswordRequest body) {
    return auth.setPassword(body.ticket(), body.password());
  }

  @PostMapping("/login")
  public IssuedSession login(@Valid @RequestBody LoginRequest body) {
    return auth.login(body.account(), body.password());
  }

  /**
   * 现在这个人是谁、能用什么。
   *
   * <p>★ BFF 在**每次**要花用户钱的操作之前都会问一遍它（见 {@code lib/auth/session.ts}）：
   * 权限从库里读的代价是每个请求一次查询，而它换来的东西很实在——
   * 管理员改完开关，那个人下一次点「开始创作」就看见变化。
   */
  @GetMapping("/me")
  public UserView me(HttpServletRequest request) {
    return auth.me(current.require(request));
  }

  @PatchMapping("/me")
  public UserView updateNickname(@RequestBody NicknameRequest body, HttpServletRequest request) {
    return auth.updateNickname(current.require(request), body.nickname());
  }

  @PatchMapping("/me/avatar")
  public UserView pickAvatar(@RequestBody AvatarRequest body, HttpServletRequest request) {
    return auth.pickAvatar(current.require(request), body.avatar());
  }

  /**
   * 改密码。
   *
   * <p>★ 路径是 {@code /api/auth/password}（PATCH）——与"设密码"那条
   * {@code POST /api/auth/password} 同一个地址、不同动词：它们动的是同一个字段，
   * 而区别在于**凭什么允许**（那边凭一张刚核验过的一次性票，这边凭旧口令）。
   * 分成两个地址（比如 `/password/change`）会让"改密码"这件事看起来是另一件事。
   */
  @PatchMapping("/password")
  public IssuedSession changePassword(
      @Valid @RequestBody ChangePasswordRequest body, HttpServletRequest request) {
    return auth.changePassword(
        current.require(request), body.currentPassword(), body.newPassword());
  }

  /**
   * 退出登录。
   *
   * <p>★ 它**什么都没做**，只回一句"好"——因为这一轮没有 token 黑名单，
   * 真正的登出动作发生在 BFF 那一层（把 cookie 删掉）。留着这条路由是为了
   * 让"登出"这件事有一个明确的落点：客户端调它、服务端**知道有人登出了**（日志），
   * 而不是"悄悄把 cookie 删了就当作没发生"。
   *
   * <p>★ 代价写在 README §五：一张已经发出去的票，在 7 天之内仍然有效。
   * 要真撤销，需要一张"失效票"表，而那是下一轮的事。
   */
  @PostMapping("/logout")
  public void logout() {
    // 有意为空
  }
}
