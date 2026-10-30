package com.onceuponme.api.credit;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.onceuponme.api.credit.dto.SettleResult;
import com.onceuponme.api.support.ApiException;

/**
 * 内部对账：给 BFF 启动时那一次扫描用（`src/instrumentation.ts` → `lib/credits/settle.ts`）。
 *
 * <p>★ 它<b>不是给用户调的</b>。两件事说明白：
 *
 * <p>1. <b>为什么不带会话票。</b>扫描发生在服务刚起来、还没有任何人在线的时候，
 * 手上不可能有一张用户的票。所以这个端点要的是 {@code userId} 这个参数。
 * 它落在 {@code /api/internal/} 下，走 {@code InternalTokenFilter} 那道令牌——
 * 而能拿到那把令牌的调用方（BFF 自己）本来就能发码、发额度，多一个 userId
 * 参数不构成提权。
 * <p>2. <b>它退不出凭空的钱。</b>退多少由 {@code CreditService#settle} 按账本算：
 * 只退"这个书号扣过、还没退过"的那部分，一个字节都不多。
 *
 * <p>★ 本地那一档没配 {@code APP_INTERNAL_TOKEN} 时这道令牌是关着的（见过滤器文件头），
 * 意思是本机上谁都能调它。它退不出钱（第 2 条），但会动账本，所以别把 8080 暴露出去。
 */
@RestController
@RequestMapping("/api/internal/credits")
public class CreditSettleController {

  private final CreditService credits;

  public CreditSettleController(CreditService credits) {
    this.credits = credits;
  }

  /** 结算一个书号上"扣过、还没结算"的那几本。没得退时回 {@code refunded: false}，不是 400 */
  @PostMapping("/settle")
  public SettleResult settle(@RequestBody SettleBody body) {
    if (body == null) throw ApiException.badRequest("bad-json", "请求体读不出来");
    return credits.settle(body.userId(), body.ref());
  }

  public record SettleBody(long userId, String ref) {}
}
