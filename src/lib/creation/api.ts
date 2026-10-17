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
 *    （`lib/engine/sse.ts` + `lib/book-stream.ts`），不是这里再写一个松一点的解析。
 *    读两条不同的解析器，会让"终端里看到的"和"屏幕上看到的"变成两份真相。
 */

import { decodeBookFrame, type BookStreamFrame } from '@/lib/book-stream.ts'
import type { ChildPickerItem } from '@/lib/children-list.ts'
import type { CharacterAnchor } from '@/lib/engine/domain.ts'
import type { EngineEvent } from '@/lib/engine/events.ts'
// ★ `import type`：`run-pages.ts` 与 `schemas/story.ts` 都是服务端那一侧的模块
//   （前者的形状来自 `book.json`），编译后这一行不存在（与 `ChildPickerItem` 那条同一写法）。
//   ★ `StoryDoc` 是**闸门那一屏要摊出来的故事**：书名 + 每页草稿。
//     它是模型写的、也是家长改的那一份——同一个形状是刻意的（见 `schemas/story.ts`）
import type { StoryDoc } from '@/lib/schemas/story.ts'
import type { RunPageView } from '@/lib/run-pages.ts'
import { createSseDecoder } from '@/lib/engine/sse.ts'

export type { StoryDoc }

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
  // ★ 2026-10-17（故事闸门）多两条：书已经画过了、故事不在了。
  //   两条都是"再点一次还是这样"，而文案里已经写清了该做什么（换主题 / 回书架）
  'book-exists',
  'story-not-found',
  'provider-not-configured',
  'card-invalid',
  'book-busy',
])

async function postJson<T>(
  url: string,
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
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
  /**
   * ★ 这一张卡**自己的**锚点，由服务端回（工单 03 第 4 刀）。
   *
   *   为什么不在这里用"刚发出去的那份表单值"顶：服务端会归一化
   *   （去空、按槽位排序），而且**换一版**那条路上真正生效的是卡里那份。
   *   客户端拿表单值当卡值，症状是"我明明没动过，它却说锚点变了"。
   */
  anchors: readonly CharacterAnchor[]
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
  /** 资产根里的相对路径。界面上要小图就用 `assetUrlOf(referencePath, 想要的宽度)`
   *  ——`referenceUrl` 指的是**原图**（2.7 MB 那一档） */
  referencePath: string
  /** 锚点原样（slot + value）。这一屏不显示它们，但 `/api/cards` 回的是 `lib/cards-list.ts`
   *  那一份统一的形状——客户端类型照着线上写，不写一个"比线上少两个字段"的假子集。
   *  ★ 类型也不另抄一份：`slot` 是封闭表（`ANCHOR_SLOTS`），在这里写成 `string`
   *  等于让一个拼错的槽位在客户端一路合法到运行时 */
  anchors: readonly CharacterAnchor[]
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
 * 有哪些小主角（创作流第 1 步的数据源，工单 03 第 4 刀）。
 *
 * ★ 与 `listCards` 同一条退路：**读不到就当没有**（空表，不是错误）。
 *   理由也一样——它是给"选一个已有的"用的，而这一屏永远有第二条路（新建一个）。
 *   让"列出已有的"失败把整屏卡住，是把一个可选的便利做成了必经步骤。
 * ★ 返回类型不在这里重写：它是 `/api/children` 回的那份视图，
 *   形状的权威在 `lib/children-list.ts`（`ChildPickerItem`）——
 *   客户端抄一份"比线上少两个字段"的假子集，第一个被裁掉的字段就会在这里悄悄丢掉。
 *   ★ 只 **re-export 类型**（`import type`，编译后不存在）：那个模块是服务端的
 *   （它读文件系统），值不能进客户端包，而形状必须与线上同源。
 */
export async function listChildren(): Promise<ChildPickerItem[]> {
  try {
    const response = await fetch('/api/children')
    if (!response.ok) return []
    const parsed = (await response.json()) as { children?: ChildPickerItem[] }
    return parsed.children ?? []
  } catch {
    return []
  }
}

export type { ChildPickerItem }

/**
 * 三条流式请求（编故事 / 重写一版 / 逐页画 / 单页重做）共用的那一段：
 * **fetch → 查状态码 → 用同一个解码器读帧**。
 *
 * ★ 2026-10-17 抽出来的。在这之前 `createBook` 与 `rerunPage` 各有一份一模一样的
 *   二十行，而这一轮又要加两条（重写、逐页画）——四份的话，改了其中一份的
 *   状态码处理就会变成"有的入口报得清、有的入口只显示 HTTP 400"，
 *   而那种差异只在出错时才看得见。
 *
 * ★ 返回的是一个**收尾**函数而不是 Promise：调用方要能在卸载时喊停
 *   （`AbortController`），否则用户点了"停止"之后，回调还会往一个已经消失的
 *   组件上写状态。
 */
function postStream(
  url: string,
  body: unknown,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return (async () => {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      if (signal?.aborted) return
      throw new ApiError({
        code: 'network',
        message: `连不上服务端（${err instanceof Error ? err.message : String(err)}）。确认 dev server 还在跑`,
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
 * 开一本：**①编故事**（故事闸门）。
 *
 * ★ 2026-10-17 起它**不再跑完一本书**：流结束时盘上只有故事草稿
 *   （`books/<id>/story.json`）与过程日志，一张图都没有。
 *   接着画是 `illustrateBook()`，而中间那一步是家长在 `StorySheet` 上过一遍。
 *   ★ 名字没有跟着改成 `planBook`：界面上"开一本"仍然只有这一个入口，
 *     而从调用方那一边看，它做的就是"开一本"（只不过这一本停在闸门前面）。
 */
export function createBook(
  body: ReturnType<typeof import('./state.ts').toBookBody>,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postStream('/api/books', body, onFrame, signal)
}

/**
 * 读这一本的故事草稿（闸门那一屏要摊出来的东西）。
 *
 * ★ 形状的权威在 `lib/schemas/story.ts` 的 `PlanDraft`（**浏览器安全**的模块），
 *   这里只搬类型——它同时是"模型写的那一份"与"家长改的那一份"，
 *   两边同一个形状是这道闸门能成立的前提（见 `story-draft.ts` 文件头）。
 */
export async function fetchStory(bookId: string): Promise<StoryDoc> {
  const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/story`)
  if (!response.ok) {
    throw new ApiError({
      code: `http-${response.status}`,
      message: '读不回这一本的故事',
      retryable: true,
    })
  }
  const parsed = (await response.json()) as { story?: StoryDoc }
  if (!parsed.story) {
    throw new ApiError({ code: 'story-not-found', message: '这一本的故事不见了', retryable: false })
  }
  return parsed.story
}

/**
 * 把改过的故事存回去（自动保存用）。
 *
 * ★ 它**不返回校验结论**：合不合法由 `lib/story-problems.ts` 那个纯函数在客户端算，
 *   与服务端「就按这个画」那一关用的是**同一个函数**——所以不存在"这里说行、
 *   那里说不行"。服务端只做信封校验（见 `story/route.ts` 文件头第 2 条）。
 */
export async function saveStory(bookId: string, doc: StoryDoc): Promise<{ savedAt: number }> {
  return postJson<{ savedAt: number }>(`/api/books/${encodeURIComponent(bookId)}/story`, doc, 'PUT')
}

/** 「让 AI 重写一版」：家长写的那一句话 + SSE 的过程（与开一本同一个协议） */
export function rewriteStory(
  bookId: string,
  note: string,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(
    `/api/books/${encodeURIComponent(bookId)}/story/rewrite`,
    { note },
    onFrame,
    signal,
  )
}

/**
 * 「就按这个画」：**②–⑦ 逐页画 / 封面 / 配音 / 装订**。
 *
 * ★ 请求体里的 `doc` 就是家长刚改完的那一份（不是"服务端自己有一份"）——
 *   这样"画出来的"与"屏幕上那一段"是同一份数据，而不是两次读盘可能读岔的两份。
 *   服务端仍会写回盘上（自动保存可能差最后一拍），并在画之前再校验一次。
 */
export function illustrateBook(
  bookId: string,
  doc: StoryDoc,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(`/api/books/${encodeURIComponent(bookId)}/illustrate`, doc, onFrame, signal)
}

/**
 * 重做**一页**（工单 01）。
 *
 * ★ 与 `createBook` 走同一个解码器、同一种帧——所以运行视图那边只有一个事件处理器。
 *   分开写一个"单页版"的解析，两条路的差异就会从第一天起生根。
 *
 * ★ 它**不是**"重跑整本"：服务端按页号找那一页、只做那一页、把结果替换回清单。
 *   重跑整本会再花一遍钱，还会把用户已经满意的 19 页一起换掉。
 */
export type RerunOptions = {
  kind: 'image' | 'audio'
  /*
   * ★ 这里原来有 `env`（ADR-0008：密钥随请求上来）。2026-10-17 整条退场（ADR-0009）：
   *   密钥由站长分配，只从服务端的 `process.env` 来。所以这个请求体现在**一个字节的
   *   密钥都不带**——网络面板上搜 "env" 搜不到任何东西，正是这一轮要的结果。
   */
  voiceId?: string
  /** 重画：家长写的"这一次哪里不对"，会接在提示词后面（见 `prompts/image.ts`） */
  fixNote?: string
  /** 重配：改过的正文，一句一段。★ 它改的是**书里那一页的字**，不只是录音 */
  body?: readonly string[]
}

export function rerunPage(
  bookId: string,
  pageNo: number,
  options: RerunOptions,
  onFrame: (frame: BookStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  return postStream(
    `/api/books/${encodeURIComponent(bookId)}/pages/${pageNo}`,
    {
      kind: options.kind,
      ...(options.voiceId ? { voiceId: options.voiceId } : {}),
      ...(options.fixNote ? { fixNote: options.fixNote } : {}),
      ...(options.body ? { body: options.body } : {}),
    },
    onFrame,
    signal,
  )
}

/**
 * 这一本每一页现在长什么样（工单 08）——运行视图上那两个弹窗要的东西。
 *
 * ★ 形状的权威在 `lib/run-pages.ts`（服务端那个纯函数算的就是它），这里只搬类型，
 *   客户端**不重写一份**子集：抄一份"比线上少两个字段"的假类型，
 *   第一个被裁掉的字段就会在这里悄悄丢掉（`api.ts` 文件头第 2 条）。
 */
export async function listRunPages(bookId: string): Promise<RunPageView[]> {
  const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/pages`)
  if (!response.ok) {
    throw new ApiError({
      code: `http-${response.status}`,
      message: '读不回这一本每一页的内容',
      retryable: true,
    })
  }
  const parsed = (await response.json()) as { pages?: RunPageView[] }
  return parsed.pages ?? []
}

/**
 * 「确定生成」：草稿 → 成品（工单 03）。
 *
 * ★ 它改的是一件**只有重新读盘才看得到**的事：清单上的 `status`。
 *   所以回的是凭据，调用方自己决定要不要 `router.refresh()` 去看新样子。
 * ★ 幂等：已经发布的再点一次也是 200，不是一句红字。
 */
export async function publishBook(bookId: string): Promise<{ bookId: string; status: string }> {
  return postJson<{ bookId: string; status: string }>(
    `/api/books/${encodeURIComponent(bookId)}/publish`,
    {},
  )
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
