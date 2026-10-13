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
  readonly detail?: unknown

  constructor(
    code: EngineErrorCode,
    message: string,
    init?: { traceId?: string; detail?: unknown },
  ) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.traceId = init?.traceId
    this.detail = init?.detail
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
