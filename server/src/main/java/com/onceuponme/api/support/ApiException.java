package com.onceuponme.api.support;

import org.springframework.http.HttpStatus;

/**
 * 业务失败。★ 它**带状态码**，而不是"抛出去由上层猜一个 500"：
 * 这个仓库里 Next 那一侧的每条路由都显式写状态码，BFF 会把它原样透传，
 * 所以这里的 4xx/5xx 是**接口契约的一部分**（界面按 401/403/429 分支）。
 */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String code;

  public ApiException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  /* ── 下面这几个是这一轮真正用到的几种，各自带一句现成的人话 ──────────────
     ★ 写成工厂方法而不是让调用点自己 new：同一种失败在两处的文案不一致，
       是"接口说话前后矛盾"最常见的来路。 */

  public static ApiException badRequest(String code, String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, code, message);
  }

  public static ApiException unauthorized(String message) {
    return new ApiException(HttpStatus.UNAUTHORIZED, "not-signed-in", message);
  }

  public static ApiException forbidden(String code, String message) {
    return new ApiException(HttpStatus.FORBIDDEN, code, message);
  }

  public static ApiException notFound(String code, String message) {
    return new ApiException(HttpStatus.NOT_FOUND, code, message);
  }

  /**
   * 验证码发得太频。★ 429 而不是 400：它是一条**限流**，不是"你的请求写错了"。
   * 界面据此说的话也不一样（"请等一会儿"而不是"号码格式不对"）。
   */
  public static ApiException tooMany(String message) {
    return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "sms-rate-limited", message);
  }

  /** 登录这一步的连错锁定。与验证码那条用同一个状态码，但 code 不同——界面要能分开说 */
  public static ApiException locked(String message) {
    return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too-many-attempts", message);
  }

  /**
   * 额度不够。★ 402 而不是 403：403 是"你不被允许"，402 是"你被允许，但这一次要付的东西不够"。
   * 界面据这一条把用户带去兑换页，而不是让他去怀疑自己的账号权限（那两件事的下一步完全不同）。
   */
  public static ApiException paymentRequired(String code, String message) {
    return new ApiException(HttpStatus.PAYMENT_REQUIRED, code, message);
  }
}
