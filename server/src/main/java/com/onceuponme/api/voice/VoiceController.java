package com.onceuponme.api.voice;

import java.util.List;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.CurrentSession;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 音色：我的有哪些、现在用哪一个、切一个、记一条、删一条（工单 16，2026-10-17）。
 *
 * <p>★ 这一整组原来是浏览器 localStorage，用户 2026-10-17 定的是
 * 「音色一并挂到账号上」——理由只有一条，而它足够：**换台设备就没了**。
 *
 * <p>★ 五条路里**四条回同一份东西**（{@link Body}）："我的音色 + 现在用哪一个"。
 * 这不是偷懒的复用，是刻意让客户端**不必自己维护一份状态**：
 * 每动一下就照服务端回的那一份整个替换，于是"切了但没存上""删了但界面还在"
 * 这两类假象没有藏身之处。（与 `/api/admin/users` 那几条"回的是这个人现在的样子"同源。）
 *
 * <p>★ 全部要登录：音色是<strong>这个人自己的</strong>东西，而且它就是 userId 那一列本身。
 * 没有登录时它回 401，而不是回一份空的列表——空列表会被读成"你没录过"。
 */
@RestController
@RequestMapping("/api/voices")
public class VoiceController {

  private final VoiceService service;
  private final CurrentSession current;
  private final AuthService auth;

  public VoiceController(VoiceService service, CurrentSession current, AuthService auth) {
    this.service = service;
    this.current = current;
    this.auth = auth;
  }

  /** 我的音色 + 现在用哪一个（首屏那一份） */
  @GetMapping
  public Body mine(HttpServletRequest request) {
    return bodyOf(user(request).getId());
  }

  /** 记一条新录的音色，并把它设为当前（刚录完就想用它） */
  @PostMapping
  public Body remember(@RequestBody RememberBody input, HttpServletRequest request) {
    long userId = user(request).getId();
    service.remember(userId, input.voiceId(), input.name(), input.model());
    return bodyOf(userId);
  }

  /**
   * 切一个，或者取消。
   *
   * <p>★ `voiceId` 为空串 = 取消选择（条目留着）。★ 用 {@code PUT} 而不是 {@code POST}：
   * 这个动作是"把这一格设成某个值"，重复发一次的结果与发一次相同（幂等），
   * 而 `POST /api/voices` 是"多一条"，那一个不幂等。
   */
  @PutMapping("/current")
  public Body choose(@RequestBody ChooseBody input, HttpServletRequest request) {
    long userId = user(request).getId();
    service.choose(userId, input.voiceId(), input.name(), input.model());
    return bodyOf(userId);
  }

  /**
   * 删掉一条。
   *
   * <p>★ 路径上带的是**厂商的 voiceId**，不是我们表的主键。理由：客户端手上有的
   * 就是它（`CatalogVoice.id`），而换成我们的 id 就得先做一次"我的列表里哪个是它"的查找，
   * 那一步在下一次刷新之后未必还有答案。★ 而 service 那边的删除条件里带着 userId，
   * 所以"删别人的那一条"在 SQL 里就不成立。
   */
  @DeleteMapping("/{voiceId}")
  public Body forget(@PathVariable String voiceId, HttpServletRequest request) {
    long userId = user(request).getId();
    service.forget(userId, voiceId);
    return bodyOf(userId);
  }

  private User user(HttpServletRequest request) {
    return auth.requireUser(current.require(request));
  }

  private Body bodyOf(long userId) {
    List<Row> rows =
        service.mine(userId).stream()
            .map(
                voice ->
                    new Row(
                        voice.getVoiceId(),
                        voice.getName(),
                        voice.getModel(),
                        Times.iso(voice.getCreatedAt())))
            .toList();
    return new Body(rows, service.chosenId(userId));
  }

  /**
   * 一条音色（给界面的形状）。
   *
   * <p>★ `createdAt` 用 ISO 字符串而不是时间戳：与别处的响应一致
   * （`Times.iso`），不然前端要为这一个字段单独记一套解析。
   * <p>★ 没有 `chosen` 这一格：当前是哪一个由外层的 `current` 说一次，
   * 每条里再说一遍就是同一个事实的两个来源，它们迟早会不一样。
   */
  public record Row(String voiceId, String name, String model, String createdAt) {}

  /** 这一组四条路的响应体。★ `current` 是**空串**表示还没挑，不是 null */
  public record Body(List<Row> voices, String current) {}

  /** 记一条：名字与模型都要（见 `VoiceService#remember` 那段） */
  public record RememberBody(String voiceId, String name, String model) {}

  /** 切一个：`voiceId` 空串 = 取消；`name` / `model` 可省（见 `VoiceService#choose`） */
  public record ChooseBody(String voiceId, String name, String model) {}
}
