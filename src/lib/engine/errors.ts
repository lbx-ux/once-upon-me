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
  | 'schema-validation-failed'
  | 'consistency-unavailable'
  | 'asset-write-failed'
  | 'card-invalid'
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
