/**
 * http.ts —— 供应商 HTTP 的公共底座
 *
 * 这里的每个 helper 都对应 `E:\compete\模型.md` 里一次实测，不是通用工具函数：
 *
 * | helper | 为什么存在 | 实测出处 |
 * | --- | --- | --- |
 * | `findMediaUrl` | 响应字段层级不一致：图像在 `data[0].url`，列表在顶层 `url`，视频在 `result.url`。硬编码任一条路径都会在另一条上静默失败 | §5 坑 1、2；§10 第 6 条 |
 * | `findFirst` | 同上，ID 字段一会儿是 `image_id` 一会儿是顶层 `id` | §5 坑 1 |
 * | `traceOf` | 错误响应用 `traceId`（驼峰），成功响应用 `trace_id`（下划线），同一个概念两种拼法 | §5 坑 3 |
 * | `shouldRetry` | **4xx 一律不重试**；生成类请求超时也不重试（服务端可能已建单，重试就是重复扣费） | §6、§10 第 8 条 |
 *
 * ★ 本文件不 import React，也不假设任何浏览器 API：`fetch` / `AbortController`
 *   在 node 18+ 与 edge 都有。
 */

import { EngineError } from '../errors.ts'

export type HttpDeps = {
  baseUrl: string
  apiKey: string
  /** 缺省 60s。图像是同步接口，一次出图实测在十几秒量级，别把超时设得太短 */
  timeoutMs?: number
}

export type HttpFailure = {
  status: number
  code: string
  message: string
  traceId: string
  body: unknown
}

/** 状态码 → 人话。403 那条尤其重要：它是**灰度权限**问题，改参数没用 */
const STATUS_HINTS: Record<number, string> = {
  401: '密钥无效或缺失',
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

/** 两种拼法都要读，少读一种就是排障时拿不到 traceId */
export function traceOf(obj: unknown): string {
  const hit = findFirst(obj, ['traceId', 'trace_id'])
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
 * 规则只有一条来自实测：**生成类请求超时不许无条件重试**
 * （异步任务可能已在服务端建单，重试 = 重复扣费）。
 * 所以这里对 2xx 之外的 5xx/网络错只放行**读取类**（GET）请求。
 */
export function shouldRetry(status: number, method: string): boolean {
  if (method !== 'GET') return false
  return status === 0 || status === 429 || status >= 500
}

/** 把一次不成功的响应变成 EngineError，消息里带供应商的中文原文（参数错误只有自然语言，没有字段名） */
export function failureToError(failure: HttpFailure, what: string): EngineError {
  const hint = STATUS_HINTS[failure.status] ?? ''
  const parts = [`${what} 失败 HTTP ${failure.status}`]
  if (failure.code) parts.push(failure.code)
  if (failure.message) parts.push(failure.message)
  if (hint) parts.push(`（${hint}）`)
  return new EngineError('provider-call-failed', parts.join(' · '), {
    traceId: failure.traceId || undefined,
    detail: failure.body,
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
 * 解析失败时**保留原文前 2000 字符**：实测供应商偶尔返回非 JSON 的网关页，
 * 只留"解析失败"四个字的话，排障只能靠猜。
 */
export async function requestJson(deps: HttpDeps, call: JsonCall): Promise<unknown> {
  const timeoutMs = call.timeoutMs ?? deps.timeoutMs ?? 60_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = call.signal ? anySignal([call.signal, controller.signal]) : controller.signal

  let status = 0
  let text = ''
  try {
    const response = await fetch(joinUrl(deps.baseUrl, call.path), {
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
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new EngineError(
      aborted ? 'aborted' : 'provider-call-failed',
      aborted
        ? `${call.path} 超时或中止（生成类请求超时**不要重试**，服务端可能已建单）`
        : `${call.path} 网络错误：${String(err)}`,
    )
  } finally {
    clearTimeout(timer)
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

/** 把签名 URL 的字节拿回来。**必须在拿到地址后立刻调用**（约 1 小时过期） */
export async function fetchBytes(
  url: string,
  init?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ bytes: Uint8Array; mime: string }> {
  const timeoutMs = init?.timeoutMs ?? 120_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = init?.signal ? anySignal([init.signal, controller.signal]) : controller.signal
  try {
    const response = await fetch(url, { signal })
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
  } finally {
    clearTimeout(timer)
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
