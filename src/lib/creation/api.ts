/**
 * api.ts —— 创作流那几个请求的**客户端**封装
 *
 * 三件事，都是为了"请求的形状只写一遍"：
 *
 * 1. `postJson` 把非 2xx 的响应翻成 `ApiFailure`——服务端的错误体是
 *    `{code, message}`（见 `/api/books`、`/api/cards` 的 `jsonError`），
 *    每个调用点各写一遍 `if (!res.ok)` 就是三份会漂的处理。
 * 2. `createCard` / `createBook` 的入参类型来自 `state.ts` 的转换函数，
 *    所以界面上不出现任何环境变量名或引擎字段名。
 * 3. **`consumeStream` 用与脚本、与将来 MCP 同一个解码器**
 *    （`lib/sse.ts` + `lib/book-stream.ts`），不是这里再写一个松一点的解析。
 *    读两条不同的解析器，会让"终端里看到的"和"屏幕上看到的"变成两份真相。
 */

import { decodeBookFrame, type BookStreamFrame } from '@/lib/book-stream.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
import { createSseDecoder } from '@/lib/sse.ts'

export type ApiFailure = { code: string; message: string; retryable: boolean }

export class ApiError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(failure: ApiFailure) {
    super(failure.message)
    this.name = 'ApiError'
    this.code = failure.code
    this.retryable = failure.retryable
  }
}

/** 凭据/配置类错误重试一百次也一样；这几条判据与服务端的 `isRetryable` 对齐 */
const NO_RETRY_CODES = new Set([
  'invalid-request',
  'bad-json',
  'card-not-found',
  'provider-not-configured',
  'card-invalid',
  'book-busy',
])

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new ApiError({
      code: 'network',
      message: `连不上服务端（${err instanceof Error ? err.message : String(err)}）。确认 dev server 还在跑`,
      retryable: true,
    })
  }

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    /* 非 JSON 的错误页（网关页之类）：下面按状态码兜底 */
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}

  if (!response.ok) {
    const code = typeof record['code'] === 'string' ? record['code'] : `http-${response.status}`
    const message =
      typeof record['message'] === 'string'
        ? record['message']
        : `服务端回了 HTTP ${response.status}：${text.slice(0, 200)}`
    // ★ 可重试性**优先听服务端的**：它手上有 httpStatus 与 code 两个结构化字段，
    //   而这里只有 code 一个。实测踩过：401 经引擎规约后 code 是 provider-call-failed，
    //   只看 code 会判成"可以再点一次"，与文案说的"key 不对"自相矛盾。
    const retryable =
      typeof record['retryable'] === 'boolean' ? record['retryable'] : !NO_RETRY_CODES.has(code)
    throw new ApiError({ code, message, retryable })
  }
  return parsed as T
}

export type CardResult = {
  cardId: string
  revision: number
  digest: string
  referenceUrl: string
  promptFragment: string
  checklist: string[]
  modelId: string
}

export async function createCard(
  body: ReturnType<typeof import('./state.ts').toCardBody>,
): Promise<CardResult> {
  return postJson<CardResult>('/api/cards', body)
}

/** 已有的卡：摘要 + 派生出来的两段（画的时候按什么画、查的时候按什么查） */
export type CardSummary = {
  cardId: string
  childId: string
  revision: number
  digest: string
  referenceUrl: string
  promptFragment: string
  checklist: string[]
  modelId: string
  /** 锚点原样（slot + value）。这一屏不显示它们，但 `/api/cards` 回的是 `lib/cards-list.ts`
      那一份统一的形状——客户端类型照着线上写，不写一个"比线上少两个字段"的假子集 */
  anchors: { slot: string; value: string }[]
  photoDeleted: boolean
}

export async function listCards(): Promise<CardSummary[]> {
  try {
    const response = await fetch('/api/cards')
    if (!response.ok) return []
    const parsed = (await response.json()) as { cards?: CardSummary[] }
    return parsed.cards ?? []
  } catch {
    // 读不到就当没有已有的卡：这一步不是必经之路，不该因为书架读不出来而卡住
    return []
  }
}

/**
 * 跑一本书，边收边回调。
 *
 * ★ 返回的是一个**收尾**函数而不是 Promise<void>：调用方要能在卸载时喊停
 *   （`AbortController`），否则用户点了"停止"之后，回调还会往一个已经消失的
 *   组件上写状态。
 */
export function createBook(
  body: ReturnType<typeof import('./state.ts').toBookBody>,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return (async () => {
    let response: Response
    try {
      response = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (signal?.aborted) return
      throw new ApiError({
        code: 'network',
        message: `连不上服务端（${err instanceof Error ? err.message : String(err)}）`,
        retryable: true,
      })
    }

    if (!response.ok || !response.body) {
      const text = await response.text()
      let message = `服务端回了 HTTP ${response.status}`
      let code = `http-${response.status}`
      try {
        const parsed = JSON.parse(text) as { code?: string; message?: string }
        if (parsed.message) message = parsed.message
        if (parsed.code) code = parsed.code
      } catch {
        /* 非 JSON：用状态码兜底 */
      }
      throw new ApiError({ code, message, retryable: !NO_RETRY_CODES.has(code) })
    }

    const decoder = createSseDecoder()
    const reader = response.body.getReader()
    const textDecoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const sse of decoder.push(textDecoder.decode(value, { stream: true }))) {
        const frame = decodeBookFrame(sse)
        if (frame) onFrame(frame)
      }
    }
  })()
}

/**
 * 重放一条已经发生过的过程（刷新之后的第一件事）。
 *
 * ★ 它返回的是**帧**而不是"进度"：服务端把 `events.jsonl` 原样回吐，
 *   客户端用同一个解码器读。客户端自己存一份"我走到哪了"，就会有两份会漂的真相。
 */
export async function replayFrames(bookId: string): Promise<{
  events: EngineEvent[]
  status?: Extract<BookStreamFrame, { kind: 'status' }>
}> {
  const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/events`)
  if (!response.ok) {
    throw new ApiError({
      code: `http-${response.status}`,
      message: '读不回这一轮的生成日志',
      retryable: true,
    })
  }
  const frames = createSseDecoder()
    .push(await response.text())
    .map((sse) => decodeBookFrame(sse))
    .filter((frame): frame is BookStreamFrame => frame !== null)
  const status = frames.find(
    (frame): frame is Extract<BookStreamFrame, { kind: 'status' }> => frame.kind === 'status',
  )
  return {
    events: frames.flatMap((frame) => (frame.kind === 'engine' ? [frame.event] : [])),
    ...(status ? { status } : {}),
  }
}
