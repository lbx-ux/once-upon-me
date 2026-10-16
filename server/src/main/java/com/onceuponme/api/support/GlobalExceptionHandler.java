package com.onceuponme.api.support;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 异常 → {@link ApiError}。一个进程里只有这一处把异常翻成人话。
 *
 * <p>★ 两条判断：
 *
 * <p>1. <b>没预料到的异常回 500 + 一句"程序出错"</b>，细节只进日志。
 * 把 {@code e.getMessage()} 原样发给浏览器，最常见的结果是把栈里的类名、
 * 甚至 SQL 片段展示给陌生人看；而这些东西对用户一个字都不管用。
 * （这一条与仓库里 `qwen-speech.ts` 那句"适配器自己的报错是写给开发者的"同源。）
 *
 * <p>2. <b>参数校验的失败要说清楚是哪一格</b>。{@code @Valid} 抛出来的东西
 * 默认只有一句英文，而界面要把它显示在一个中文表单下面。
 *
 * <p>★ 3. <b>"这条路不存在 / 这个动词不对 / 这个格式不收"是 4xx，不是 500</b>。
 * 这条是 2026-10-17 实测撞出来的：{@link Exception} 那条兜底会把 Spring 自己
 * 抛的 {@link HttpRequestMethodNotSupportedException} 一起吞掉，于是
 * {@code PATCH /api/auth/password}（当时那个动词还没写）在日志里是一条带完整栈的
 * "未预料到的失败"，在浏览器里是"程序出错，请过一段时间再试"——
 * 而真相是"这个地址不接受 PATCH"，一句开发者一眼就该看懂的话。
 * 代价不只是难查：**500 是监控会报警的那一档**，把"打错了地址"混进去，
 * 真正出事那天就没有信号了。所以下面三条各自认领自己的状态码。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<ApiError> handleApi(ApiException ex) {
    // ★ 预期内的失败**不写日志**（或只写 debug）：验证码发错一次是日常，
    //   每条都记会在真出事那天把有用的信号淹掉
    return ResponseEntity.status(ex.status()).body(new ApiError(ex.code(), ex.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
    String message =
        ex.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(error -> error.getDefaultMessage() == null ? "填的内容不合法" : error.getDefaultMessage())
            .orElse("填的内容不合法");
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .body(new ApiError("invalid-request", message));
  }

  @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class})
  public ResponseEntity<ApiError> handleUnreadable(Exception ex) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .body(new ApiError("bad-json", "请求体不是合法的 JSON，或者少了一个必填字段"));
  }

  /** 地址在、动词不对（例如对 {@code /api/auth/password} 用了 PUT）。回 405 并**带上允许哪些** */
  @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
  public ResponseEntity<ApiError> handleWrongMethod(HttpRequestMethodNotSupportedException ex) {
    String allowed = String.join(", ", ex.getSupportedMethods() == null ? new String[0] : ex.getSupportedMethods());
    return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
        .body(new ApiError("method-not-allowed", "这个地址不接受 " + ex.getMethod() + "，它认的是：" + allowed));
  }

  /** 地址本身不存在。★ 回 404 而不是 500：这是"你打错了"，不是"我坏了" */
  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ApiError> handleNoRoute(NoResourceFoundException ex) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND)
        .body(new ApiError("not-found", "没有这个接口"));
  }

  /** {@code Content-Type} 不是 JSON（比如表单提交打过来） */
  @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<ApiError> handleWrongMediaType(HttpMediaTypeNotSupportedException ex) {
    return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
        .body(new ApiError("bad-content-type", "请求体要发 JSON（Content-Type: application/json）"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiError> handleUnexpected(Exception ex) {
    log.error("未预料到的失败", ex);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(new ApiError("internal-error", "程序出错，请过一段时间再试"));
  }
}
