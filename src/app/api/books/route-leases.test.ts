/**
 * route-leases.test.ts —— 「预流准备失败时，租约必须还回去」这一族路由的纪律
 *（2026-10-20，本仓库**第一批驱动 Route Handler 的测试**）
 *
 * ## 它守的是什么
 *
 * 「取租约 → 预流准备 → 放租约」这三步里，**中间那一步失败时租约必须还回去**。
 * 两条路由原来的形状一样：
 *
 * ```ts
 * if (!tryStartRun(runKey)) return jsonError(409, 'book-busy', …)
 * …createProviders（这一段**有** catch → finishRun）…
 * await log.truncate(bookId)   // ← 裸的，写盘，会抛
 * const stream = new ReadableStream({ … finally { finishRun(runKey) } })
 * ```
 *
 * `truncate` 抛出来时（资产根只读、磁盘满、目录权限），`finishRun` **永远不执行**：
 * 这本书记在这一进程里永远是"在跑"，此后每一次点它都收 409「这本书正在生成中」，
 * 直到进程重启；而用户看到的是一个未捕获的 500，不是一句人话。紧邻的
 * `createProviders` 失败就老老实实还了租约——所以这是同一套纪律上漏掉的那一格，
 * 不是"设计上没想"。
 *
 * ## 为什么要这么一套脚手架
 *
 * 这一层以前**没有测试缝**：`vitest` 只收 `src` 下面的 `.test.ts`，而路由要先过
 * `requireCapability`（要一张真签名票 + 问 Java 要权限），再落真磁盘。四样都在
 * 测试里临时搭：
 *
 * | 要什么 | 怎么给 |
 * | --- | --- |
 * | 登录态 | 自己用 `APP_JWT_SECRET` 签一张 `scope: 'session'` 的 HS256 票，塞进 cookie |
 * | 权限 | 一个只回 `/api/auth/me` 的**假后端**（`node:http`，端口系统挑），`BACKEND_URL` 指过去 |
 * | 资产根 | `mkdtemp` 一个临时目录，`ASSET_ROOT` 指过去 |
 * | 模型配置 | 三个 `*_BASE_URL` 一律指向 `127.0.0.1:9`——★ 见下面那条纪律 |
 *
 * ★ **`127.0.0.1:9` 是刻意的**（discard 端口，没人监听）：这一组用例**绝不许**
 *   打到真厂商。配一个"看起来像真的"地址能跑通，是因为它在任何一条意外路径上
 *   都只会立刻 `ECONNREFUSED`，而不是把一次请求发出去。
 *   对照档正是靠这条保证"引擎真跑了、而且真失败了"。
 *
 * ★ 假后端只认一条路：`/api/auth/me` → `{allowed: true, …}`。别的路径回 404，
 *   好让"路由多问了一句"当场显形。
 */

import { createHmac } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POST as postBook } from './route.ts'
import { POST as postRewrite } from './[bookId]/story/rewrite/route.ts'
import { createUserStore } from '@/lib/asset-scope.ts'
import { finishRun, isRunning, runKeyOf } from '@/lib/books-runtime.ts'
import {
  attachReferenceDigest,
  bookIdOf,
  buildCard,
  createCardStore,
  type BookRequest,
  type CharacterCard,
} from '@/lib/engine/index.ts'
import { writeStory, type StoryDraft } from '@/lib/story-draft.ts'
import type { PlanDraft } from '@/lib/schemas/story.ts'

const USER_ID = '1'
const BOOK_ID = 'kid-x-7c1f0a9b2d34'
const CARD_ID = 'card-route-test'
const JWT_SECRET = 'route-test-secret-not-a-real-one-0123456789abcdef'
/** 假后端与"厂商"都落在回环上；9 是 discard 端口，没人监听 → 立刻 ECONNREFUSED */
const NOWHERE = 'http://127.0.0.1:9'

const CHILD = {
  childId: 'kid-x',
  name: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6' as const,
  lookTags: ['短发'],
  interestTags: ['云'],
}

/**
 * 五条硬锚点的值。★ **五条都得有**：`buildCard` 会拿 `checkAnchors` 卡一道
 * （实测报「缺骨相；缺头发；缺头身比；缺肤色」），少一条这一组用例就红在
 * "夹具没搭起来"上，而不是红在要测的那条路上。
 */
const ANCHORS = [
  { slot: 'bone', value: '脸圆润' },
  { slot: 'eyes', value: '深棕圆眼' },
  { slot: 'hair', value: '黑直短发' },
  { slot: 'build', value: '头身比 1:4' },
  { slot: 'skin', value: '肤白皙' },
] as const

/**
 * 三页的合法故事表（`planDraftCodec` 的 `nodes` 是 `min: 3`）。
 * ★ 返回类型写成 `PlanDraft` 而不是手写的 `{title, nodes: unknown[]}`：
 *   后者看着更省事，但它正是在"信封对不对"这件事上放水的那种写法——
 *   而这一组用例的语义依赖那份信封（`writeStory` 落盘、`readStory` 读回）。
 */
function storyDoc(): PlanDraft {
  const node = (scene: string, body: string) => ({
    scene,
    body: [body],
    imagePrompt: '小女孩站在窗前，窗外一整片绿',
    mood: 'wonder',
  })
  return {
    title: '小乐的绿天空',
    nodes: [
      node('她把天空涂成绿色', '她把天空涂成了绿色。'),
      node('绿色顺着窗缝漏了出去', '绿色顺着窗缝漏了出去。'),
      node('整座城都绿了', '整座城都绿了，她合上了眼睛。'),
    ],
  }
}

/* ───────────────────────── 脚手架 ───────────────────────── */

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

/** 只回 `/api/auth/me` 的假后端。端口交给系统挑（并行跑测试时不会撞） */
async function startFakeBackend(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/auth/me')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          userId: USER_ID,
          account: `u${USER_ID}`,
          phone: null,
          nickname: '路线测试',
          role: 'USER',
          createdAt: '2026-10-20T00:00:00Z',
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
 * 一个人的那一片盘：一张卡 + 一份故事草稿（都走仓库自己的出口真写盘）。
 * 返回那张卡——`bookIdOf` 要用它算书号。
 *
 * ★ 用 `createCardStore().save()` 与 `writeStory()` 而不是手搓 JSON：
 *   手搓的那份一旦与信封校验漂了，症状是"测试红了，但红在 404 card-not-found"——
 *   那时候查的是测试，而真正要测的那条路一步都没走。
 */
async function seedUserSlice(root: string): Promise<CharacterCard> {
  const store = await createUserStore(root, USER_ID)
  const card = attachReferenceDigest(
    buildCard({
      cardId: CARD_ID,
      childId: CHILD.childId,
      anchors: [...ANCHORS],
      style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
      referencePath: `cards/${CARD_ID}/ref.aaaaaaaaaaaa.png`,
      referenceBytes: 4,
      referenceMime: 'image/png',
      modelId: 'fake-image',
      promptVersion: 'card@v1',
      now: 0,
    }),
    'aaaaaaaaaaaa',
  )
  await createCardStore(store).save(card)

  const draft: StoryDraft = {
    bookId: BOOK_ID,
    input: {
      child: CHILD,
      cardId: CARD_ID,
      cardRevision: card.revision,
      theme: '云',
      form: 'solo',
    },
    doc: storyDoc(),
    provenance: { modelId: 'fake-text', promptVersion: 'story-plan@v5', attempts: 1 },
    planMs: 1000,
    createdAt: 0,
  }
  await writeStory(store, draft)
  return card
}

/**
 * 带一张真票的请求。`POST` 的 `ctx.params` 在 Next 15 里是 Promise，照那个形状给。
 * ★ 形参类型跟着 `params` 推（`P`）：写成 `Record<string, string>` 的话，
 *   路由那边要的 `{ bookId: string }` 收窄不下来，`tsc` 会在测试里报
 *   "Property 'bookId' is missing"——那条红指向的是脚手架，不是被测的那条路。
 */
function authed<P extends Record<string, string>>(
  url: string,
  body: unknown,
  params: P,
): [NextRequest, { params: Promise<P> }] {
  const request = new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `xzj_session=${mintSession(USER_ID)}`,
    },
    body: JSON.stringify(body),
  })
  return [request, { params: Promise.resolve(params) }]
}

/* ───────────────────────── 固定装置 ───────────────────────── */

let root = ''
let card: CharacterCard
let backend: { server: Server; url: string }
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

  root = await mkdtemp(join(tmpdir(), 'xzj-route-'))
  backend = await startFakeBackend()

  process.env['APP_JWT_SECRET'] = JWT_SECRET
  process.env['BACKEND_URL'] = backend.url
  process.env['ASSET_ROOT'] = root
  // 管理页那份覆盖指到一个**不存在**的地方：不这样做，本机真有一份
  // `models.runtime.json` 时它会压过下面这些测试值，这一组用例就不再自足
  process.env['MODEL_CONFIG_FILE'] = join(root, 'no-such-model-config.json')
  // ★ 三个地址全部指向 discard 端口：见文件头那条纪律
  process.env['LLM_BASE_URL'] = NOWHERE
  process.env['LLM_API_KEY'] = 'route-test-key'
  process.env['LLM_MODEL'] = 'route-test-model'
  process.env['IMAGE_BASE_URL'] = NOWHERE
  process.env['IMAGE_API_KEY'] = 'route-test-key'
  process.env['IMAGE_MODEL'] = 'route-test-model'
  process.env['VISION_BASE_URL'] = NOWHERE
  process.env['VISION_API_KEY'] = 'route-test-key'
  process.env['VISION_MODEL'] = 'route-test-model'
  delete process.env['TTS_API_KEY']
  delete process.env['TTS_MODEL']

  card = await seedUserSlice(root)
})

afterEach(async () => {
  // 租约是一份**进程级**的账（`globalThis`）：一条用例漏还，下一条就会被误挡
  for (const bookId of [BOOK_ID, bookIdOfForTest(card)]) {
    finishRun(runKeyOf(USER_ID, bookId))
  }
  await new Promise<void>((resolve) => backend.server.close(() => resolve()))
  await rm(root, { recursive: true, force: true })
  for (const key of TOUCHED) {
    const previous = savedEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

/** 「开一本」那条路会按它推书号：卡 + 版 + 形态 + 主题 */
function bookIdOfForTest(current: CharacterCard): string {
  const request = {
    child: CHILD,
    card: current,
    theme: '云',
    form: 'solo',
  } as unknown as BookRequest
  return bookIdOf(request)
}

/**
 * 把 `events.jsonl` 做成一个**目录**：读路径不受影响（`read()` 吞异常、
 * `story.json` 是它的兄弟），而 `truncate()` 的 `writeFile` 会当场 EISDIR
 * （本机实测的码就是这个）。
 */
async function poisonEventsFile(bookId: string): Promise<void> {
  await mkdir(join(root, 'u', USER_ID, 'books', bookId, 'events.jsonl'), { recursive: true })
}

/* ───────────────────────── 用例 ───────────────────────── */

describe('预流准备失败时租约要还', () => {
  it('★ 重写一版：事件日志写不进去（EISDIR）→ 回一句人话，租约还了', async () => {
    await poisonEventsFile(BOOK_ID)

    const [request, ctx] = authed(
      `http://localhost:3311/api/books/${BOOK_ID}/story/rewrite`,
      { note: '把结尾改得平静一点' },
      { bookId: BOOK_ID },
    )
    const res = await postRewrite(request, ctx)

    // 1) 不是"未捕获的异常把整条路由带走"，而是一个说得清的响应
    expect(res.status).toBe(500)
    const body = (await res.json()) as { code?: string; message?: string }
    expect(body.code).toBe('asset-write-failed')
    expect(body.message ?? '').toMatch(/EISDIR|directory/i)

    // 2) ★ 这一条才是这个文件存在的理由
    expect(isRunning(runKeyOf(USER_ID, BOOK_ID))).toBe(false)
  })

  it('★ 开一本：同一道闸（`books/route.ts` 的 truncate 也在租约窗口里）', async () => {
    const bookId = bookIdOfForTest(card)
    await poisonEventsFile(bookId)

    // ★ 这一条路由**没有** `[bookId]` 那一段，所以它只收一个参数
    const [request] = authed(
      'http://localhost:3311/api/books',
      {
        child: CHILD,
        cardId: CARD_ID,
        theme: '云',
        form: 'solo',
        mode: 'live',
      },
      {},
    )
    const res = await postBook(request)

    expect(res.status).toBe(500)
    const body = (await res.json()) as { code?: string; message?: string }
    expect(body.code).toBe('asset-write-failed')
    expect(body.message ?? '').toMatch(/EISDIR|directory/i)
    expect(isRunning(runKeyOf(USER_ID, bookId))).toBe(false)
  })

  it('对照档：健康资产根下能走过截断那一步（否则上面两条可能在"哪一步都到不了"时也绿）', async () => {
    const [request, ctx] = authed(
      `http://localhost:3311/api/books/${BOOK_ID}/story/rewrite`,
      { note: '把结尾改得平静一点' },
      { bookId: BOOK_ID },
    )
    const res = await postRewrite(request, ctx)

    // 过了所有前置检查、租约在手、流已经起来了
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // ★ 把流读完：引擎真的跑起来了（它会去连 discard 端口，必然失败）
    const text = await res.text()
    expect(text).toContain('fatal')

    // 跑完了 → 租约也该还了（`finally` 那条路，与上面两条是**两条**不同的路）
    expect(isRunning(runKeyOf(USER_ID, BOOK_ID))).toBe(false)
  })
})
