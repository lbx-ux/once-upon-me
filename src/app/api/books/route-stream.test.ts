/**
 * route-stream.test.ts —— 令牌级增量真的从这条路由出去了吗（2026-10-21，工单 D-04）
 *
 * 这一条守的是一个**接了一半**的能力。`plan.ts` 的 `onDelta`、
 * `providers/openai-text.ts` 的 `stream()`、`engine/plan-stream.ts` 的
 * `readPlanProgress` 三件都写好了、都有测试，而 `src/app/**` **一处都没传** ——
 * 于是"故事正在一页页写出来"这个交互在线上一次都没跑过，故事是在 `plan-ready`
 * 那一刻整张出现的。评分报告在 §2.17 为这一条扣了 −14（全篇单项最重）。
 *
 * 判据是**只有真做才会不同的那一个**：SSE 的字节里有没有 `event: delta`。
 * 没有接 `onDelta` 时这条路一样能跑完（`plan.ts` 会退到 `text.complete`），
 * 一样会写盘、一样会发 `plan-ready` —— 唯独不会有 delta 帧。
 *
 * 四件事一起钉住：
 *
 * | # | 判据                                                      | 错了会怎样 |
 * | - | --------------------------------------------------------- | ---------- |
 * | 1 | 流里出现 `event: delta`，拼起来等于模型写的那张故事表      | 那一栏白扣 14 分（本次要修的就是它） |
 * | 2 | delta **排在 `plan-ready` 前面**                           | "等 plan-ready 才出现"——正是原来那个坏法 |
 * | 3 | `events.jsonl` 里**没有** `delta`                          | 不落盘那条纪律破了，日志会从几十行变几十万行 |
 * | 4 | 故事真的落盘了、租约也还了                                 | 证明这一轮没被 delta 这条路走歪 |
 *
 * ★ 假"厂商"是本机一个真的 SSE 服务（`node:http`）：它照 OpenAI 的线格式回
 *   `data: {"choices":[{"delta":{"content":"…"}}]}`。**不 mock 模块** ——
 *   真路由 + 真适配器 + 真 `plan.ts` 走一遍，中间任何一层没接上这条用例都抓得到。
 *   非流式的请求（`stream` 不为 true）它回一整段 JSON：于是"把 onDelta 拿掉"
 *   这件事会让 1、2 两条红，而不是让整条路崩掉（判别点要能单独指认）。
 */

import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as postBook } from './route.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { isRunning, runKeyOf } from '@/lib/books-runtime.ts'
import { readPlanProgress } from '@/lib/engine/plan-stream.ts'
import {
  attachReferenceDigest,
  buildCard,
  createCardStore,
  type CharacterCard,
} from '@/lib/engine/index.ts'

const USER_ID = '1'
const CARD_ID = 'card-stream-test'
const JWT_SECRET = 'route-stream-secret-not-a-real-one-0123456789abcdef'
/** 没被用到的三项能力指向 discard 端口：这一组用例只该打到本机那个假厂商 */
const NOWHERE = 'http://127.0.0.1:9'

const CHILD = {
  childId: 'kid-s',
  name: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6' as const,
  lookTags: ['短发'],
  interestTags: ['云'],
}

/** 三页的合法故事表（`planDraftCodec` 的 `nodes` 是 `min: 3`） */
const STORY = {
  title: '小乐的绿天空',
  nodes: [
    {
      scene: '她把天空涂成绿色',
      body: ['她把天空涂成了绿色。'],
      imagePrompt: '小女孩站在窗前，窗外一整片绿',
      mood: 'wonder',
    },
    {
      scene: '绿色顺着窗缝漏了出去',
      body: ['绿色顺着窗缝漏了出去。'],
      imagePrompt: '绿色的光从窗缝里漏出来',
      mood: 'wonder',
    },
    {
      scene: '整座城都绿了',
      body: ['整座城都绿了，她合上了眼睛。'],
      imagePrompt: '整座城市的屋顶都变成了绿色',
      mood: 'wonder',
    },
  ],
}
const STORY_JSON = JSON.stringify(STORY)

const ANCHORS = [
  { slot: 'bone', value: '脸圆润' },
  { slot: 'eyes', value: '深棕圆眼' },
  { slot: 'hair', value: '黑直短发' },
  { slot: 'build', value: '头身比 1:4' },
  { slot: 'skin', value: '肤白皙' },
] as const

/** 一张 `scope: 'session'` 的 HS256 票。★ 与 `lib/auth/session.ts` 的验票逐字对齐 */
function mintSession(userId: string): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: userId,
    acc: `u${userId}`,
    role: 'USER',
    scope: 'session',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

/** 只回 `/api/auth/me` 的假后端（与 `route-leases.test.ts` 同一个形状） */
async function startFakeBackend(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/auth/me')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          userId: USER_ID,
          account: `u${USER_ID}`,
          phone: null,
          nickname: '流式测试',
          role: 'USER',
          createdAt: '2026-10-21T00:00:00Z',
          allowed: true,
        }),
      )
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 'not-found', message: `假后端没有这条路：${req.url}` }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}` }
}

/**
 * 假的文本厂商：一个真的 SSE 服务。
 *
 * ★ 流式的请求回一段段 `data: {...}`（OpenAI 的线格式，照 `openai-text.ts` 的
 *   `deltaObject` 认得的形状写）；非流式的请求回一整段 JSON。
 *   两条都实现是刻意的：**把 `onDelta` 拿掉之后这一条路仍然能跑完**
 *   （`plan.ts` 退到 `text.complete`），于是那条用例红在"没有 delta 帧"上，
 *   而不是红在"整条流崩了"上——判别点要能单独指认。
 */
async function startFakeVendor(): Promise<{
  server: Server
  url: string
  streamCalls: () => number
}> {
  let streamCalls = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      // ★ 路径是 `/v1/chat/completions`（适配器的 `joinUrl` 会补 `/v1`）——
      //   按"含 chat/completions"匹配，别再按开头匹配一次
      if (!req.url?.includes('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `假厂商没有这条路：${req.url}` } }))
        return
      }
      const body = JSON.parse(raw) as { stream?: boolean }
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'fake-1',
            model: 'fake-text',
            choices: [{ index: 0, message: { role: 'assistant', content: STORY_JSON } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        )
        return
      }

      streamCalls += 1
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      // ★ 切成小段发：一段太少就测不出"一页一页写出来"（`readPlanProgress` 只认
      //   闭合的字符串与对象，切成 12 段足以让标题、正文、页数依次出现）
      const size = Math.ceil(STORY_JSON.length / 12)
      for (let at = 0; at < STORY_JSON.length; at += size) {
        const piece = STORY_JSON.slice(at, at + size)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      }
      res.write(
        `data: ${JSON.stringify({
          model: 'fake-text',
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })}\n\n`,
      )
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}`, streamCalls: () => streamCalls }
}

/* 固定装置 */

let root = ''
let card: CharacterCard
let backend: { server: Server; url: string }
let vendor: { server: Server; url: string; streamCalls: () => number }
const savedEnv: Record<string, string | undefined> = {}
const TOUCHED = [
  'APP_JWT_SECRET',
  'BACKEND_URL',
  'ASSET_ROOT',
  'MODEL_CONFIG_FILE',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'IMAGE_BASE_URL',
  'IMAGE_API_KEY',
  'IMAGE_MODEL',
  'VISION_BASE_URL',
  'VISION_API_KEY',
  'VISION_MODEL',
  'TTS_API_KEY',
  'TTS_MODEL',
] as const

beforeEach(async () => {
  for (const key of TOUCHED) savedEnv[key] = process.env[key]

  root = await mkdtemp(join(tmpdir(), 'xzj-stream-'))
  backend = await startFakeBackend()
  vendor = await startFakeVendor()

  process.env['APP_JWT_SECRET'] = JWT_SECRET
  process.env['BACKEND_URL'] = backend.url
  process.env['ASSET_ROOT'] = root
  process.env['MODEL_CONFIG_FILE'] = join(root, 'no-such-model-config.json')
  // 文本走本机那个假厂商；其余三项指向 discard 端口（这一组用例不该碰到它们）
  process.env['LLM_BASE_URL'] = vendor.url
  process.env['LLM_API_KEY'] = 'stream-test-key'
  process.env['LLM_MODEL'] = 'fake-text'
  // ★ 图像那一路要求地址以 /api/v1 结尾（registry 的 pathPrefix 判据，2026-10-21）
  process.env['IMAGE_BASE_URL'] = `${NOWHERE}/api/v1`
  process.env['IMAGE_API_KEY'] = 'stream-test-key'
  process.env['IMAGE_MODEL'] = 'fake-image'
  process.env['VISION_BASE_URL'] = NOWHERE
  process.env['VISION_API_KEY'] = 'stream-test-key'
  process.env['VISION_MODEL'] = 'fake-vision'
  delete process.env['TTS_API_KEY']
  delete process.env['TTS_MODEL']

  const store = await createUserStore(root, USER_ID)
  card = attachReferenceDigest(
    buildCard({
      cardId: CARD_ID,
      childId: CHILD.childId,
      anchors: [...ANCHORS],
      style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
      referencePath: `cards/${CARD_ID}/ref.bbbbbbbbbbbb.png`,
      referenceBytes: 4,
      referenceMime: 'image/png',
      modelId: 'fake-image',
      promptVersion: 'card@v1',
      now: 0,
    }),
    'bbbbbbbbbbbb',
  )
  await createCardStore(store).save(card)
})

afterEach(async () => {
  await new Promise<void>((resolve) => backend.server.close(() => resolve()))
  await new Promise<void>((resolve) => vendor.server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  for (const key of TOUCHED) {
    const previous = savedEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

/** 起一本并把整条流读完。返回：原始 SSE 文本 + 书号 */
async function runOnce(): Promise<{ raw: string; bookId: string }> {
  const request = new NextRequest('http://localhost:3311/api/books', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `xzj_session=${mintSession(USER_ID)}`,
    },
    body: JSON.stringify({
      child: CHILD,
      cardId: CARD_ID,
      theme: '云',
      form: 'solo',
      pages: 3,
      mode: 'live',
      status: 'draft',
    }),
  })
  const res = await postBook(request)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const raw = await res.text()
  const hit = /"bookId":"([^"]+)"/.exec(raw)
  expect(hit).not.toBeNull()
  return { raw, bookId: (hit as RegExpExecArray)[1] }
}

/** 流里的 `data:` 载荷逐条解出来（`event:` 与 `data:` 成对） */
function framesOf(raw: string): { event: string; data: string }[] {
  const frames: { event: string; data: string }[] = []
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? ''
    const dataLines = lines.filter((line) => line.startsWith('data: '))
    if (event === '' || dataLines.length === 0) continue
    frames.push({ event, data: dataLines.map((line) => line.slice('data: '.length)).join('\n') })
  }
  return frames
}

describe('令牌级增量从这条路由出去', () => {
  it('★ 流里有 delta 帧，拼起来就是模型写的那张故事表', async () => {
    const { raw } = await runOnce()
    const deltas = framesOf(raw).filter((frame) => frame.event === 'delta')
    expect(deltas.length).toBeGreaterThan(1)

    const joined = deltas.map((frame) => (JSON.parse(frame.data) as { text: string }).text).join('')
    expect(JSON.parse(joined)).toEqual(STORY)
    // 每一段都报了"这是从网络上一段段来的"（离线回放那一档才该是 false）
    for (const frame of deltas) {
      expect((JSON.parse(frame.data) as { streamed: boolean }).streamed).toBe(true)
    }
  })

  it('★ delta 排在 `plan-ready` 前面（它证的是"正在写"，不是"写完了"）', async () => {
    const { raw } = await runOnce()
    const firstDelta = raw.indexOf('event: delta')
    const firstReady = raw.indexOf('"kind":"plan-ready"')
    expect(firstDelta).toBeGreaterThan(-1)
    expect(firstReady).toBeGreaterThan(-1)
    expect(firstDelta).toBeLessThan(firstReady)
    // 收尾那一帧仍然在最后（客户端靠它拿书号）
    expect(raw.indexOf('"kind":"status"')).toBeGreaterThan(firstReady)
  })

  it('★ 增量一条都不落盘（`events.jsonl` 是回放的依据，打字机动画不是状态）', async () => {
    const { bookId, raw } = await runOnce()
    // ★ 先证"真的发过"：不然这一条在"delta 整个没了"的实现下也会绿
    //   ——那样它就不是判据，只是一句同义反复（摘掉路由的 `onDelta` 时实测过这一点）
    expect(framesOf(raw).filter((frame) => frame.event === 'delta').length).toBeGreaterThan(1)
    const text = await readFile(join(root, 'u', USER_ID, 'books', bookId, 'events.jsonl'), 'utf8')
    expect(text).not.toContain('"kind":"delta"')
    // 而语义事件该在的都在：这一轮真的跑完了
    expect(text).toContain('"kind":"plan-ready"')
  })

  it('故事真的落盘了，租约也还了（delta 这条路没有把主流程带走）', async () => {
    const { bookId, raw } = await runOnce()
    const saved = JSON.parse(
      await readFile(join(root, 'u', USER_ID, 'books', bookId, 'story.json'), 'utf8'),
    ) as { doc: { title: string; nodes: { scene: string; body: string[] }[] } }
    // ★ 不按整份深比对：草稿里还有归一化补上的字段（`iconA` / `emojiB` 那些）。
    //   这一条要证的是"模型写的那三页正文真的走到了盘上"，比对标题与正文就够。
    expect(saved.doc.title).toBe(STORY.title)
    expect(saved.doc.nodes.map((node) => node.body)).toEqual(STORY.nodes.map((node) => node.body))
    expect(saved.doc.nodes.map((node) => node.scene)).toEqual(STORY.nodes.map((node) => node.scene))
    expect(raw).toContain('"bookReady":false')
    expect(isRunning(runKeyOf(USER_ID, bookId))).toBe(false)
    // 真的打了流式那一档（不是"退到 complete 也能过"）
    expect(vendor.streamCalls()).toBe(1)
  })
})

describe('对照档：这一串增量按规矩读出来是什么', () => {
  /**
   * ★ 这一条不是走形式，它验的是 D-04 这件事**能不能被信任**：
   *   `engine/plan-stream.ts` 那条唯一的规矩是"只认已经闭合的东西"，
   *   而屏幕上"已写 k / N 页"这句话成立与否，完全取决于**真实的分段方式**下
   *   它读出什么。所以这里拿上面那条用例发出来的**真 delta 段**去累加，
   *   一段一段喂给 `readPlanProgress`，判三件事：
   *
   *   1. 单调：页数与行数只增不减、已经写出来的句子不许变（变了就是"闪过的字不是真写完的"）；
   *   2. 中间就有东西可看：`plan-ready` 之前某一页已经闭合过（否则这一屏还是黑的，
   *      D-04 就只修了传输、没修交互）；
   *   3. 最后读出来的页数等于故事表的页数（3）。
   */
  it('★ 真 delta 段累加出来：只增不减，且 `plan-ready` 之前就有整页闭合', async () => {
    const { raw } = await runOnce()
    const deltas = framesOf(raw)
      .filter((frame) => frame.event === 'delta')
      .map((frame) => (JSON.parse(frame.data) as { text: string }).text)
    expect(deltas.length).toBeGreaterThan(1)

    let seen = ''
    let lastPages = 0
    let lastLines: string[] = []
    let closedBeforeEnd = false
    for (const piece of deltas.slice(0, -1)) {
      seen += piece
      const progress = readPlanProgress(seen)
      expect(progress.pages).toBeGreaterThanOrEqual(lastPages)
      expect(progress.lines.length).toBeGreaterThanOrEqual(lastLines.length)
      // 已经写出来的句子一个字都不许改（那正是"闪过的半句再改掉"那个坏法）
      expect(progress.lines.slice(0, lastLines.length)).toEqual(lastLines)
      // 标题要么还没到，到了就不许换
      if (lastLines.length > 0) expect(progress.lines[0]).toBe(lastLines[0])
      if (progress.pages > 0) closedBeforeEnd = true
      lastPages = progress.pages
      lastLines = [...progress.lines]
    }
    expect(closedBeforeEnd).toBe(true)

    // 最后一段补上之后就是整张表
    const final = readPlanProgress(seen + deltas[deltas.length - 1])
    expect(final.pages).toBe(3)
    expect(final.lines).toHaveLength(3)
    expect(final.title).toBe(STORY.title)
  })
})

/**
 * ★ 2026-10-22：家长在创作页打了一句「小兔子受伤流血了」，屏幕上只看到
 *   「编故事这一步没有回书号」。服务端其实说得很清楚——这一条钉的是**它真的说出去了**：
 *   fatal 帧里带着词（流血）与条款（R-02），而不是一句"回创作重来"。
 *
 * 客户端那一半（流结束时别拿兜底盖掉具体原因）也在同一天改了，但它在 `use-run-stream.ts`
 * 里，没有 DOM 测试架子；这一条至少保证"服务端把该说的话说了"。
 */
describe('家长那句话越线：fatal 里是哪个词、哪一条', () => {
  it('★ 带词与条款 id，不是"没有回书号"', async () => {
    const request = new NextRequest('http://localhost:3311/api/books', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `xzj_session=${mintSession(USER_ID)}`,
      },
      body: JSON.stringify({
        child: CHILD,
        cardId: CARD_ID,
        theme: '小兔子受伤流血了',
        form: 'solo',
        pages: 3,
        mode: 'live',
        status: 'draft',
      }),
    })
    const res = await postBook(request)
    expect(res.status).toBe(200)
    const frames = framesOf(await res.text())

    /*
     * 屏幕那一句是短的（用户 2026-10-22 拍板）；"是哪一条、哪个词"在**同一条流**的
     * `review` 事件里——日志与过程面板读的是它，所以这里两处都要钉。
     */
    const review = frames
      .filter((frame) => frame.event === 'engine')
      .map(
        (frame) =>
          JSON.parse(frame.data) as {
            event?: { kind?: string; reason?: string }
          },
      )
      .find((one) => one.event?.kind === 'review')
    expect(review?.event?.reason).toContain('R-02')
    expect(review?.event?.reason).toContain('血')

    const fatal = frames.find((frame) => frame.event === 'fatal')
    expect(fatal).toBeDefined()
    const payload = JSON.parse(fatal?.data ?? '{}') as { code?: string; message?: string }
    expect(payload.code).toBe('input-blocked')
    expect(payload.message).toBe('你写的这句话里有不该给孩子看的内容，已经在编故事之前拦下了')
    // 那句兜底只在"这一轮一句话都没说过"时才该出现
    expect(payload.message).not.toContain('没有回书号')
  })
})
