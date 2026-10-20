/**
 * http.ts —— 供应商 HTTP 的公共底座。
 *
 * 这里的每个 helper 都对应 `E:\compete\模型.md` 里一次实测，不是通用工具函数：
 *
 * - `findMediaUrl`：响应字段层级不一致——图像在 `data[0].url`，列表在顶层 `url`，视频在
 *   `result.url`。硬编码任一条路径都会在另一条上静默失败。
 * - `findFirst`：同上，ID 字段一会儿是 `image_id` 一会儿是顶层 `id`。
 * - `traceOf`：错误响应用 `traceId`（驼峰），成功响应用 `trace_id`（下划线），同一个概念
 *   两种拼法。
 * - `shouldRetry`：4xx 一律不重试；生成类请求超时也不重试（服务端可能已建单，重试就是重复
 *   扣费）。
 *
 * 本文件不 import React，也不假设任何浏览器 API：`fetch` / `AbortController` 在 node 18+
 * 与 edge 都有。
 */

import { EngineError } from '../errors.ts'
import { createSseDecoder } from '../sse.ts'

export type HttpDeps = {
  baseUrl: string
  apiKey: string
  /** 缺省 60s。图像是同步接口，一次出图实测在十几秒量级，别把超时设得太短 */
  timeoutMs?: number
  /**
   * 注入用的 `fetch`。存在的理由只有一个：流式解析要能测。
   *
   * 不注入的话，"SSE 帧一行行解析"这件事只能靠真发一次请求来验，
   *   而它恰恰是最容易写错、又最难从现象上看出来的那一层（少读一个 `data:` 前缀、
   *   把 `[DONE]` 当成一帧、跨 chunk 的半行没接起来——都表现为"内容少了一截"）。
   *   与 `AssetStore` 的 memory 实现同一条理由：能喂进假输入的东西才测得住。
   */
  fetchImpl?: typeof fetch
}

export type HttpFailure = {
  status: number
  code: string
  message: string
  traceId: string
  body: unknown
}

/** 状态码 → 人话。403 那条尤其重要：它是灰度权限问题，改参数没用 */
const STATUS_HINTS: Record<number, string> = {
  401: '密钥无效或缺失',
  // 402 是 2026-10-15 那次 20 页跑测打到过的：一页一页递进到第 13 页时账户没余额了。
  //   它与网络、与参数都无关，重试与改 prompt 都是白费——所以必须像 403 那样写明
  //   "往哪走"，否则下一个人会把 402 读成配置问题。这一句能这么确定，是因为
  //   供应商的原文（`INSUFFICIENT_BALANCE · 余额不足`）当时跟着一起上来了。
  402: '账户余额不足——重试与改参数都无用，要去充值（与网络、与模型权限都无关）',
  403: '未获该模型的灰度权限（改参数无用，要去找平台申请）',
  413: '请求体超限',
  422: '参数或上游输入限制不满足',
  429: '容量限流',
  502: '上游故障',
  503: '上游不可用',
  504: '上游超时',
}

/** 递归找第一个像媒体地址的字符串。顺序敏感：先查常见键名，再深度遍历 */
const MEDIA_KEYS = ['url', 'image_url', 'video_url', 'download_url', 'result_url', 'oss_url']

export function findMediaUrl(obj: unknown): string | null {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findMediaUrl(item)
      if (hit) return hit
    }
    return null
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of MEDIA_KEYS) {
      const value = record[key]
      if (typeof value === 'string' && value.startsWith('http')) return value
    }
    for (const value of Object.values(record)) {
      const hit = findMediaUrl(value)
      if (hit) return hit
    }
  }
  return null
}

export function findFirst(obj: unknown, keys: readonly string[]): string | number | null {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findFirst(item, keys)
      if (hit !== null) return hit
    }
    return null
  }
  if (obj && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    for (const key of keys) {
      const value = record[key]
      if (value !== null && value !== undefined && value !== '') return value as string | number
    }
    for (const value of Object.values(record)) {
      const hit = findFirst(value, keys)
      if (hit !== null) return hit
    }
  }
  return null
}

/**
 * 三种拼法都要读，少读一种就是排障时拿不到 traceId。
 *
 * 第三种（`request_id`）是 2026-10-20 补的，因为那天真需要它：阿里云 dashscope 的
 *   `voice-enrollment` 间歇性回 500，要报障就得报出他们认的那一串号，而他们的错误体里
 *   写的正是 `request_id` —— 前两种拼法都读不到，于是那句错误落到界面上时一个号都没有，
 *   报障只能靠描述时间点。
 */
export function traceOf(obj: unknown): string {
  const hit = findFirst(obj, ['traceId', 'trace_id', 'request_id'])
  return hit === null ? '' : String(hit)
}

function codeOf(obj: unknown): string {
  const hit = findFirst(obj, ['code'])
  return hit === null ? '' : String(hit)
}

function messageOf(obj: unknown): string {
  const hit = findFirst(obj, ['message', 'error', 'detail'])
  return hit === null ? '' : String(hit)
}

/**
 * 该不该重试这一次请求。
 *
 * 规则只有一条来自实测：生成类请求超时不许无条件重试
 * （异步任务可能已在服务端建单，重试 = 重复扣费）。
 * 所以这里对 2xx 之外的 5xx/网络错只放行读取类（GET）请求。
 */
export function shouldRetry(status: number, method: string): boolean {
  if (method !== 'GET') return false
  return status === 0 || status === 429 || status >= 500
}

/**
 * `fetch` 抛出来的那个 `TypeError: fetch failed` 底下到底是什么。
 *
 * ★ 为什么必须做这件事（2026-10-15 实测）。跑一本 20 页的书时本机网络断了约 36 分钟，
 *   17 页只留下同一行字：
 *
 *   ```
 *   /images/generations 网络错误：TypeError: fetch failed
 *   ```
 *
 *   而这一行底下至少是四件完全不同的事，处置也完全不同：
 *
 *   | code                                            | 是什么                       | 重试安全吗                       |
 *   | ----------------------------------------------- | ---------------------------- | -------------------------------- |
 *   | `ENOTFOUND` / `EAI_AGAIN`                       | 域名解析不了                 | 安全，请求没到服务端         |
 *   | `ECONNREFUSED`                                  | 连上了但对面拒绝             | 安全，同上                   |
 *   | `UND_ERR_CONNECT_TIMEOUT` / `ETIMEDOUT`         | 连不上，超时                 | 安全，同上                   |
 *   | `ECONNRESET` / `UND_ERR_SOCKET`                 | 连上了、中途被掐断           | 不安全，服务端可能已经处理了 |
 *
 *   最后一行正是"出图超时不许重试"那条纪律要防的事。看不出是哪一件，就没法定重试策略——
 *   而这一层在此之前把它一律印成"网络错误"，等于把判据丢了。
 *
 * undici 把真实原因塞在 `cause` 里；主机名解析出多个地址时它还是个 `AggregateError`，
 * 所以要往下再走一层。取不到 code 时照实说取不到，不编一个。
 */
const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: '域名解析不了（DNS 或网络断了）——请求没到服务端',
  EAI_AGAIN: 'DNS 暂时查不到（网络切换的瞬间常见）——请求没到服务端',
  ECONNREFUSED: '对面拒绝连接（服务没起或端口不通）——请求没到服务端',
  ETIMEDOUT: '连接超时',
  UND_ERR_CONNECT_TIMEOUT: '连接超时（undici 自己的上限）',
  UND_ERR_SOCKET: '套接字坏了——**这一种重试不一定是安全的**',
  ECONNRESET: '连接被对面掐断（可能已经处理过了）——**这一种重试不一定是安全的**',
  CERT_HAS_EXPIRED: '证书过期',
}

export function describeNetworkError(err: unknown): string {
  const codes = networkCodesOf(err)

  const head = codes.size > 0 ? `${String(err)} · ${[...codes].join('/')}` : String(err)
  const hints = [...new Set([...codes].map((code) => NETWORK_HINTS[code]))].filter(
    (hint): hint is string => Boolean(hint),
  )
  return hints.length > 0 ? `${head} — ${hints.join('；')}` : head
}

/** 顺着 `cause` 与 `AggregateError.errors` 把 code 收上来（深度上限 3，环状也安全） */
function networkCodesOf(err: unknown): Set<string> {
  const codes = new Set<string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 3 || node === null || typeof node !== 'object') return
    const record = node as { code?: unknown; errors?: unknown; cause?: unknown }
    if (typeof record.code === 'string' && record.code !== '') codes.add(record.code)
    walk(record.cause, depth + 1)
    if (Array.isArray(record.errors)) {
      for (const inner of record.errors) walk(inner, depth + 1)
    }
  }
  walk(err, 0)
  return codes
}

/**
 * 连接级失败的重试上限与退避。
 *
 * 退避只有 1.2s，所以它治的是抖动（几秒级的 DNS 失手、网关瞬断），
 *   治不了断网：2026-10-15 那次中断持续了约 36 分钟，多等 1.2 秒救不回 17 页。
 *   那种要靠"跑完再回头补失败的页"，是另一件事，没做——别把这条当成它的替代品。
 */
const NETWORK_ATTEMPTS = 2
const NETWORK_RETRY_BACKOFF_MS = 1200

/**
 * 这一次连接级失败，重试安全吗——判据是"请求到底有没有可能到过服务端"。
 *
 * | code                                        | 请求到过服务端吗 | 重试               |
 * | ------------------------------------------- | ---------------- | ------------------ |
 * | `ENOTFOUND` / `EAI_AGAIN`（DNS 解析不了）   | 没有         | 安全，放行         |
 * | `ECONNREFUSED`（连上了但对面拒绝）          | 没有         | 安全，放行         |
 * | `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT`     | 没有         | 安全，放行         |
 * | `ECONNRESET` / `UND_ERR_SOCKET`（中途被掐） | 有可能到过   | 不安全，不放行 |
 *
 * 三条纪律，从保守那一侧取：
 *   1. 判不出 code 就不重试。拿不到判据时，"不重试"是唯一不花钱的那一边。
 *   2. 混着出现就不重试。`AggregateError` 里只要有一个 `ECONNRESET`，整次都不重——
 *      多地址并发连接时，"有一部分可能已经送到"就等于"可能已经建单"。
 *   3. **超时/中止不走这里**（调用点已经先挡掉 `AbortError`）。
 *
 * 重复扣费的风险不是零，是"被换成了很小的一个数"：放行的那几种在语义上都是
 *   连接没有建立，服务端不该看见这个请求。用户 2026-10-15 拍的就是这个换法。
 */
export function isSafeToRetryNetwork(err: unknown): boolean {
  const codes = networkCodesOf(err)
  if (codes.size === 0) return false
  return [...codes].every((code) => NEVER_REACHED_SERVER.has(code))
}

const NEVER_REACHED_SERVER = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 把一次不成功的响应变成 EngineError，消息里带供应商的中文原文
 * （参数错误只有自然语言，没有字段名）。
 *
 * 状态码与供应商错误码同时塞进结构化字段：message 是给人读的，界面文案分流
 *   要靠 `httpStatus` / `providerCode`（见 errors.ts 的注释与 app 层的
 *   `provider-messages.ts`）。这里不改 message 的措辞——它对开发者仍然有用。
 */
export function failureToError(failure: HttpFailure, what: string): EngineError {
  const hint = STATUS_HINTS[failure.status] ?? ''
  const parts = [`${what} 失败 HTTP ${failure.status}`]
  if (failure.code) parts.push(failure.code)
  if (failure.message) parts.push(failure.message)
  if (hint) parts.push(`（${hint}）`)
  return new EngineError('provider-call-failed', parts.join(' · '), {
    traceId: failure.traceId || undefined,
    detail: failure.body,
    httpStatus: failure.status,
    providerCode: failure.code || undefined,
  })
}

export type JsonCall = {
  method: 'GET' | 'POST'
  path: string
  /** 不传就是没有请求体（GET 查询串请自己拼在 path 里） */
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * 一次 JSON 请求。返回解析后的对象；非 2xx 抛 EngineError。
 *
 * 解析失败时保留原文前 2000 字符：实测供应商偶尔返回非 JSON 的网关页，
 * 只留"解析失败"四个字的话，排障只能靠猜。
 *
 * 连接级失败重试一次（2026-10-15 加，见 `isSafeToRetryNetwork` 的注释）：
 *   只重"确定没到服务端"的那几种（DNS 解析不了、连接被拒、连接超时）。
 *   **超时/中止照旧一次都不重**——那条纪律针对的是"请求已经送到、服务端可能已建单"。
 */
export async function requestJson(deps: HttpDeps, call: JsonCall): Promise<unknown> {
  const timeoutMs = call.timeoutMs ?? deps.timeoutMs ?? 60_000

  let status = 0
  let text = ''
  // 最后一次失败一定要抛出去：循环里除了"重试一次"没有别的出口
  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const signal = call.signal ? anySignal([call.signal, controller.signal]) : controller.signal
    try {
      const response = await (deps.fetchImpl ?? fetch)(joinUrl(deps.baseUrl, call.path), {
        method: call.method,
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deps.apiKey}`,
        },
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      })
      status = response.status
      text = await response.text()
      break
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      // 判据是"这一次失败安不安全重试"，不是"失败了就再试一次"。
      //   `aborted` 与 `ECONNRESET` 都会落到这里，而它们都不许重试。
      const retryable = !aborted && attempt < NETWORK_ATTEMPTS && isSafeToRetryNetwork(err)
      if (!retryable) {
        throw new EngineError(
          aborted ? 'aborted' : 'provider-call-failed',
          aborted
            ? `${call.path} 超时或中止（生成类请求超时**不要重试**，服务端可能已建单）`
            : `${call.path} 网络错误：${describeNetworkError(err)}`,
        )
      }
    } finally {
      clearTimeout(timer)
    }
    await delay(NETWORK_RETRY_BACKOFF_MS)
  }

  const body = parseJsonOrRaw(text)
  if (status >= 400 || status === 0) {
    throw failureToError(
      { status, code: codeOf(body), message: messageOf(body), traceId: traceOf(body), body },
      call.path,
    )
  }
  return body
}

/* 流式（工单 07） */

/**
 * 流式调用的缺省空闲超时。
 *
 * 它和"总超时"不是一个数，这是这一层最容易做错的地方：全量调用的超时问的是
 *   "多久没回话算失败"，流式问的是"多久没有新帧算失败"。思考模型（实测见
 *   `openai-text.ts` 的 `DEFAULT_TEXT_MAX_TOKENS`）会先想几千字才吐第一个 token，
 *   把 180s 的总超时拿来当空闲超时用，等于给"慢模型"判死刑；
 *   反过来，用空闲超时当总超时，则一条永不结束的流会一直挂在那里。
 *
 * 判据是"网络上一个字节都没有"，不是"我们没有往外发 delta"。
 *   实测（`scripts/probe-stream-gaps.mts`，2026-10-15，qwen3.8-flash，
 *   `LLM_THINKING` 关，3 页故事表 ×2 次）：
 *
 *   ```
 *   TTFT（到第一个 delta）    0.70s / 3.08s
 *   相邻两个 delta 的最大间隔 0.28s / 0.45s（p50 66–70ms，各 113/142 个间隔）
 *   ```
 *
 *   同一天另一次思考开着的实测里，模型连发了 9202 字的思考链、正文一个字没有——
 *   那 80 秒里我们的 `onDelta` 一次都没响，但连接上一直有帧。
 *   如果这一层按"我们有没有 delta"计时，思考模型会被判成"上游卡住"，
 *   而那正是最不该被打断的一种正常情况。
 *
 * 45s 就是拿上面那些数定的：比实测最大值高两个数量级，同时远小于 180s 的总超时，
 * 所以"卡死"仍会在两分钟内被发现。它是下界不是够用线：换一家更慢的，
 * 按实测调 `--idleTimeoutMs`（调用点）或 `deps.timeoutMs`。
 */
export const DEFAULT_SSE_IDLE_TIMEOUT_MS = 45_000

export type SseCall = {
  method: 'POST'
  path: string
  body?: unknown
  signal?: AbortSignal
  /** 整个流的上限（与全量调用同义：这一次调用最多花多久） */
  timeoutMs?: number
  /** 多久没有新帧就判失败。见 `DEFAULT_SSE_IDLE_TIMEOUT_MS` 的注释 */
  idleTimeoutMs?: number
}

/**
 * 一次 SSE 请求。逐帧 yield `data:` 的载荷；`[DONE]` 不 yield（它是终止标记，不是内容），
 * 流结束由函数返回表示。
 *
 * 两处刻意的处理：
 *
 * 1. **分帧交给 `engine/sse.ts`**（见那个文件的第一段）：跨 chunk 的半行、多行 `data:`、
 *    心跳注释、只有 `event:` 没有 `data:` 的块，都由那一份实现说了算。
 *    这里只负责它不该管的两件事——超时与把字节喂给它。
 * 2. 两个超时分开计时：总超时扣在整个流上，空闲超时每收到一块就重置。
 *    报错时说清是哪一个超的——"慢"和"卡死"的处置完全不同。
 */
export async function* requestSse(
  deps: HttpDeps,
  call: SseCall,
): AsyncGenerator<string, void, undefined> {
  const totalMs = call.timeoutMs ?? deps.timeoutMs ?? 180_000
  const idleMs = call.idleTimeoutMs ?? DEFAULT_SSE_IDLE_TIMEOUT_MS
  const controller = new AbortController()
  const signal = call.signal ? anySignal([call.signal, controller.signal]) : controller.signal
  /** 哪一个超时开的枪。AbortError 本身不带这个信息，而这两种错的处置不一样 */
  let fired: 'total' | 'idle' | 'caller' | null = null
  /** 响应头阶段的总超时。拿到响应体之后会被换成"读流阶段"的那个（见下面 armIdle 之后） */
  let totalTimer = setTimeout(() => {
    fired = 'total'
    controller.abort()
  }, totalMs)

  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(joinUrl(deps.baseUrl, call.path), {
      method: call.method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${deps.apiKey}`,
      },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
    })
  } catch (err) {
    clearTimeout(totalTimer)
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new EngineError(
      aborted ? 'aborted' : 'provider-call-failed',
      aborted
        ? `${call.path} 连不上就中止了（${totalMs / 1000}s 内没有响应头）`
        : `${call.path} 网络错误：${describeNetworkError(err)}`,
    )
  }

  // 非 2xx：必须把响应体读出来再报错。网关的 400 里那句自然语言是唯一的线索
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    clearTimeout(totalTimer)
    const body = parseJsonOrRaw(text)
    throw failureToError(
      {
        status: response.status,
        code: codeOf(body),
        message: messageOf(body),
        traceId: traceOf(body),
        body,
      },
      call.path,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  // 分帧用的是 `engine/sse.ts` 那同一份解码器（浏览器读 `/api/books` 也是它）。
  //   自己在这儿再写一遍"按行切、半行留缓冲"曾经真的发生了：两处各有一份，
  //   而在其中一处修对（比如跨 chunk 的半行）不会让另一处跟着对——
  //   "少了一截内容却不报错"正是那种错的症状。同一条理由见那个文件的文件头。
  const frames = createSseDecoder()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * 正在等待的这一块数据。两个超时都通过拒绝它来打断等待。
   *
   * ★ 不能只靠 `controller.abort()`：abort 能打断的只有真实的 fetch，
   *   而"上游开着连接、一个字节都不发"正是最容易卡住的那种故障——
   *   在那种情况下 read() 会一直挂着，信号也救不了它（测试替身更是完全不受信号影响）。
   *   所以超时自己把等待拒掉，abort 只是顺手放的连接。
   */
  let abortWait: ((err: unknown) => void) | null = null
  let wait: Promise<never> = new Promise<never>(() => {})

  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    wait = new Promise<never>((_, reject) => {
      abortWait = reject
    })
    idleTimer = setTimeout(() => {
      fired = fired ?? 'idle'
      controller.abort()
      abortWait?.(timeoutError(fired, call.path, totalMs, idleMs))
    }, idleMs)
  }
  // 总超时也走同一个出口：它到点时，"正在等的那一块"就是它要打断的东西
  clearTimeout(totalTimer)
  totalTimer = setTimeout(() => {
    fired = fired ?? 'total'
    controller.abort()
    abortWait?.(timeoutError(fired, call.path, totalMs, idleMs))
  }, totalMs)

  try {
    armIdle()
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([reader.read(), wait])
      } catch (err) {
        if (err instanceof EngineError) throw err
        // 真实的 fetch 被 abort 时在这里抛 AbortError：把它翻成"是哪一个超时"
        if (fired !== null) throw timeoutError(fired, call.path, totalMs, idleMs)
        throw err
      }
      if (chunk.done) break
      armIdle()
      for (const frame of frames.push(decoder.decode(chunk.value, { stream: true }))) {
        if (frame.data === '[DONE]') return
        yield frame.data
      }
    }
    // 流结束：把缓冲里的最后半行也交出来（网关不补结尾空行时，那半行就是最后一段正文）
    for (const frame of frames.flush()) {
      if (frame.data === '[DONE]') return
      yield frame.data
    }
  } finally {
    clearTimeout(totalTimer)
    if (idleTimer) clearTimeout(idleTimer)
    reader.cancel().catch(() => {
      /* 已经结束的流再 cancel 会抛，忽略：这里只是为了尽快放掉连接 */
    })
  }
}

/** 哪一个超时开的枪 → 说清是哪一种，因为"慢"与"卡死"的处置完全不同 */
function timeoutError(
  fired: 'total' | 'idle' | 'caller',
  path: string,
  totalMs: number,
  idleMs: number,
): EngineError {
  if (fired === 'idle') {
    return new EngineError(
      'aborted',
      `${path} 空闲超过 ${idleMs / 1000}s 没有新内容（**空闲超时**，不是总超时）——上游卡住了，或者这家在两次输出之间想得太久`,
    )
  }
  if (fired === 'total') {
    return new EngineError(
      'aborted',
      `${path} 超过 ${totalMs / 1000}s 还没读完（**总超时**）——这一次调用花得太久了`,
    )
  }
  return new EngineError('aborted', `${path} 被调用方中止`)
}

function parseJsonOrRaw(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text.slice(0, 2000) }
  }
}

/** baseUrl 带不带尾斜杠、path 带不带头斜杠都能拼对。供应商文档里两种写法都出现过 */
export function joinUrl(base: string, path: string): string {
  const head = base.replace(/\/+$/, '')
  const tail = path.startsWith('/') ? path : `/${path}`
  return head + tail
}

/**
 * 把签名 URL 的字节拿回来。必须在拿到地址后立刻调用（约 1 小时过期）
 *
 * 这一段原来只有 `try/finally`、没有 `catch`（2026-10-15 深夜补上）。
 *   后果是它成了整个引擎里唯一一条不报判据的网络路径：实测拿到的报错原文就是
 *   一个光秃秃的 `fetch failed`，既没有 code 也没有主机名，而它其实发生在
 *   另一个完全不同的主机上——出图走 `tokenrhythm.studio`，
 *   下载成品图走 `*.oss-cn-beijing.aliyuncs.com`。两跳可以各自独立地坏，
 *   而"哪一跳坏了"这件事在那条消息里看不出来。实测那次是 `ECONNRESET`（TLS 握手期被重置）。
 *
 * 只报主机名，绝不报整条 URL：签名 URL 的查询串里带着 `x-oss-credential` 与
 *   `x-oss-signature`，那是一次性的临时凭据，进日志就等于把凭据抄了一遍。
 *
 * `fetchImpl` 存在的理由与 `HttpDeps.fetchImpl` 相同：能喂进假输入的东西才测得住，
 * 而这条路径的可测之处恰恰是"报错里有没有主机名、有没有把签名漏出去"。
 */
export async function fetchBytes(
  url: string,
  init?: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<{ bytes: Uint8Array; mime: string }> {
  const timeoutMs = init?.timeoutMs ?? 120_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = init?.signal ? anySignal([init.signal, controller.signal]) : controller.signal
  try {
    const response = await (init?.fetchImpl ?? fetch)(url, { signal })
    if (!response.ok) {
      throw new EngineError(
        'asset-write-failed',
        `下载媒体失败 HTTP ${response.status}（签名 URL 约 1 小时过期，过期请回查任务接口拿新地址）`,
      )
    }
    const buffer = await response.arrayBuffer()
    return {
      bytes: new Uint8Array(buffer),
      mime: response.headers.get('content-type') ?? guessMime(url),
    }
  } catch (err) {
    // 上面那条 HTTP 非 2xx 已经是 EngineError 了，别把它二次包装
    if (err instanceof EngineError) throw err
    const aborted = err instanceof Error && err.name === 'AbortError'
    const where = hostOf(url)
    throw new EngineError(
      aborted ? 'aborted' : 'asset-write-failed',
      aborted
        ? `下载媒体超时或中止（${timeoutMs / 1000}s 上限，主机 ${where}）`
        : `下载媒体网络错误：${describeNetworkError(err)}（主机 ${where}）`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** 只取主机名用于报错：签名 URL 的查询串里是临时凭据，不许进消息 */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(地址解析不了)'
  }
}

function guessMime(url: string): string {
  const clean = url.split('?')[0] ?? url
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.mp4')) return 'video/mp4'
  if (clean.endsWith('.mp3')) return 'audio/mpeg'
  return 'application/octet-stream'
}

/** AbortSignal.any 在较新的 node 才有，这里自己写一个，不赌运行时版本 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

/** data URL：把落盘的字节变成"能塞进 JSON 请求"的形式。视觉比对与参考图都用它 */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${base64(bytes)}`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 自己写 base64：`Buffer` 在 edge 运行时不可用，而这段代码要能同时在 node 与路由里跑 */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += b === undefined ? '=' : B64[(n >> 6) & 63]
    out += c === undefined ? '=' : B64[n & 63]
  }
  return out
}
