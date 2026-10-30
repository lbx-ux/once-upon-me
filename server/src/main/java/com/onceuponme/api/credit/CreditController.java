package com.onceuponme.api.credit;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.CurrentSession;
import com.onceuponme.api.auth.JwtService;
import com.onceuponme.api.credit.dto.BalanceView;
import com.onceuponme.api.credit.dto.CreditView;
import com.onceuponme.api.credit.dto.RedeemResult;
import com.onceuponme.api.support.ApiException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 一个人自己的额度：看、兑换，以及 BFF 在出图前后调的那两条（扣 / 退）。
 *
 * <p>★ 每条都走 {@link #sessionOf}：它同时判"这张票还有效吗"与"这个人被停用了吗"。
 * 额度是钱，不能只看票的签名——一张改密码之前签发的票不该还能花额度。
 *
 * <p>★ {@code spend} / {@code refund} 是**给 BFF 调的**，不是给浏览器调的：
 * 浏览器那一侧没有对应的 Next 路由（`grep src/app/api/credits` 只有 GET 与 redeem）。
 * 它们仍然要求会话票，所以即使有人从别的进程带着一张票来打，动的也只会是那个人的额度；
 * 而退款按书号幂等，不能拿它凭空造额度。
 */
@RestController
@RequestMapping("/api/credits")
public class CreditController {

  private final CreditService credits;
  private final CurrentSession current;
  private final AuthService auth;

  public CreditController(CreditService credits, CurrentSession current, AuthService auth) {
    this.credits = credits;
    this.current = current;
    this.auth = auth;
  }

  /** 余额 + 最近 50 笔流水 */
  @GetMapping
  public CreditView view(HttpServletRequest request) {
    return credits.view(sessionOf(request).userId());
  }

  /** 只要一个数：创作页那颗小胶囊问的就是它 */
  @GetMapping("/balance")
  public BalanceView balance(HttpServletRequest request) {
    return new BalanceView(credits.balanceOf(sessionOf(request).userId()));
  }

  /**
   * 扣一本。★ 出图那一路在**所有 4xx 检查之后、真正开画之前**调它。
   * 回的是扣完之后的余额，界面据此把"还剩 N 本"换成新数。
   */
  @PostMapping("/spend")
  public BalanceView spend(@RequestBody SpendBody body, HttpServletRequest request) {
    if (body == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    int books = body.books() <= 0 ? 1 : body.books();
    return new BalanceView(credits.spend(sessionOf(request).userId(), books, body.ref()));
  }

  /**
   * 退一本。★ 只在"这一次一页都没画出来"时调；按书号幂等，打两次无害。
   */
  @PostMapping("/refund")
  public BalanceView refund(@RequestBody RefundBody body, HttpServletRequest request) {
    if (body == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    int books = body.books() <= 0 ? 1 : body.books();
    return new BalanceView(credits.refund(sessionOf(request).userId(), books, body.ref()));
  }

  /** 用户输入一张码。★ 成功才回换到几本，失败一律同一句话 */
  @PostMapping("/redeem")
  public RedeemResult redeem(@RequestBody RedeemBody body, HttpServletRequest request) {
    if (body == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    return credits.redeem(sessionOf(request).userId(), body.code());
  }

  /** 票有效 + 人还在 + 没被停用。三件事都只写在 `AuthService#requireUser` 里 */
  private JwtService.Session sessionOf(HttpServletRequest request) {
    JwtService.Session session = current.require(request);
    auth.requireUser(session);
    return session;
  }

  public record SpendBody(int books, String ref) {}

  public record RefundBody(int books, String ref) {}

  public record RedeemBody(String code) {}
}
