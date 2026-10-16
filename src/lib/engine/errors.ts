/**
 * errors.ts —— 引擎的显式失败
 *
 * 一条总原则：**没有静默降级**。
 * registry 读不到 key 时抛 `ProviderNotConfigured`，而不是"那就用预生成的吧"——
 * 后者会让一次本该暴露的配置问题变成一个看起来正常的演示，
 * 等到评审当天才发现"原来一直是假数据"。选哪条路径必须是**声明**出来的
 * （见 providers/registry.ts 的 `mode`），不是 fallback 出来的。
 */

export type EngineErrorCode =
  | 'provider-not-configured'
  | 'provider-call-failed'
  /** 模型回话了，但回的**不是我们要的那个形状**（该出 JSON 却写了一堆散文）。
   *  ★ 与 `schema-validation-failed` 分开：那一个是"故事表写不合格"（要换模型重跑整步），
   *  这一个是"读照片/关系判定这种一句话的活儿没按格式答"（再点一次通常会好）。
   *  两者对家长的意思完全不同：前者要改选择，后者只是这一次没成。 */
  | 'provider-bad-response'
  | 'schema-validation-failed'
  | 'consistency-unavailable'
  | 'asset-write-failed'
  | 'card-invalid'
  /** 家长上传的参考图不合格（太小 / 太细长 / 根本不是图）。★ 与 `card-invalid` 分开：
   *  两者的"该做什么"完全不同——前者要换一张照片，后者要改锚点。合成一个码，
   *  界面就只能说一句"不合格"，而家长拿那句话不知道该动哪里 */
  | 'reference-invalid'
  /** 孩子的**档案**不合格（名字/读音/年龄档缺项或越界）。
   *  ★ 与 `card-invalid` 再分一次，理由与上一条同源但方向不同：档案是"他是谁"，
   *  卡是"他长什么样"——名字没填要去第 1 步补，锚点不合格要去第 3 步改。
   *  合成一个码，界面就只能说"信息不完整"，而家长不知道不完整的是哪一格。 */
  | 'profile-invalid'
  /** 要找的那张卡不存在（`setLatest` 指到一版没有的、或页面上带着一个删掉了的卡号）。
   *  ★ 它以前只作为 `/api/cards` 手写的一个 JSON 字段存在，不在这个联合类型里——
   *  于是错误→文案那条链路上没有它的位置，`userFailureOf` 也判不出该回 404 还是 400。 */
  | 'card-not-found'
  /** 这本书里没有这一页（页码越界，或者这本书的故事表本来就只有 N 页）。
   *  ★ 与 `card-not-found` 分开是因为"该做什么"完全不同：那个要回创作流重选一张卡，
   *  这个只是**页码不对**——界面上的成因多半是"另一台机器上这本书重跑过一遍、
   *  页数变少了"，刷新一下就好。合成一个码，界面就只能说"找不到"，
   *  而家长不知道该刷新还是该重做。 */
  | 'page-not-found'
  /** 请求本身就缺东西（没勾同意、没选文件、上传超了上限）。
   *  ★ 与 `reference-invalid` 分开：那一个是"这张照片不行"（换一张），
   *  这一个是"这次请求不完整"（把缺的补上）——而**没勾同意**尤其不能混进去：
   *  它要是落到"这张照片不能用作参考图，换一张更清楚的"，家长会去换照片，
   *  而真正缺的是一个勾。工单 02 §五 记过同一类事故（照片的问题给了锚点的指示）。 */
  | 'invalid-request'
  | 'tree-invalid'
  | 'aborted'

export class EngineError extends Error {
  readonly code: EngineErrorCode
  /** 排障用的供应商 traceId。实测同一概念两种拼法（traceId / trace_id），提取时两个都读 */
  readonly traceId?: string
  /**
   * 供应商回的 HTTP 状态码（本地错误、网络错、超时都没有它）。
   *
   * ★ 为什么它是一个**结构化字段**而不是留在 message 里：
   *   ADR-0008 之后错误有了第二个读者——终端用户。界面要按"401 是 key 不对 /
   *   403 是没这个模型的权限 / 404 是模型名不存在 / 429 是限流"分流文案，
   *   而那个分流**绝不能靠正则去匹配 message**：message 是给人读的，
   *   改一个字就会把界面文案改坏，而且这种坏法没有任何测试会红。
   */
  readonly httpStatus?: number
  /** 供应商自己的错误码（`REASONING_REQUIRED` / `invalid_api_key`…），原样带出来 */
  readonly providerCode?: string
  readonly detail?: unknown

  constructor(
    code: EngineErrorCode,
    message: string,
    init?: {
      traceId?: string
      detail?: unknown
      httpStatus?: number
      providerCode?: string
    },
  ) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.traceId = init?.traceId
    this.detail = init?.detail
    this.httpStatus = init?.httpStatus
    this.providerCode = init?.providerCode
  }
}

/** 把任何异常规约成 EngineError，供流水线的 catch 统一发 error 事件 */
export function asEngineError(err: unknown): EngineError {
  if (err instanceof EngineError) return err
  if (err instanceof Error) {
    return new EngineError('provider-call-failed', `${err.name}: ${err.message}`, { detail: err })
  }
  return new EngineError('provider-call-failed', String(err))
}
