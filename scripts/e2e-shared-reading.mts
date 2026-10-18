/**
 * e2e-shared-reading.mts —— 共读版**从一句话到读得了**的全链路（工单 08）
 *
 * ```bash
 * node scripts/e2e-shared-reading.mts --base=http://127.0.0.1:3311
 * node scripts/e2e-shared-reading.mts --until=story     # 只验到闸门那一步（不花钱在图上）
 * ```
 *
 * ★★ **打一台生产服务器，别打 dev**（2026-10-18 实测撞了两次）：
 *   ④ 那一步要连着跑 20–35 分钟，而 **dev server 一读到 `next.config.ts` 的变化就会
 *   自己重启**——这个仓库里常有别的会话在同一个工作区里写文件，改一下 `next.config.ts`
 *   就够。重启那一刻在飞的请求全断（客户端看到的是 `terminated` / `ECONNRESET`），
 *   而**服务端那一轮真的也跟着死了**（不是"客户端断开 ≠ 后端停手"那条覆盖的情形：
 *   那是说往一个关掉的流里写不该带崩日志，不是说进程被杀还能跑）。
 *   生产服务器不看文件，没人能中途把它重启：
 *
 * ```bash
 * NEXT_DIST_DIR=.next-build pnpm build && NEXT_DIST_DIR=.next-build npx next start -p 3352
 * ```
 *
 * ★ 前提三样，缺一样它就在第一步红：一台 dev server、**活着的那台后端**
 *   （登录要过它，`session.ts` 文件头第 3 条：判不了权限一律不放行）、
 *   以及 `.env.local` 里的模型密钥。★ **这一趟真花钱**：它会编一个故事、
 *   画 7–8 张图、配十来段音（`--pages=` 可以改小，最小 3）。
 *
 * ## 它验的是什么（以及每一条红的时候说明什么）
 *
 * 前面几单各自验过自己那一层（04 阅读器、05 闸门、06 书架、07 路径记忆），
 * 但它们都对着**夹具**（`mk-shared-fixture.mjs` 手拼的书）。这一条验的是
 * **那本书是真的长出来的**：一句话 → 编故事 → 家长改一个字 → 出图 → 读 → 选。
 * 所以判据都落在"只有真做才会不同"的几种量上：
 *
 * | 判据                                        | 什么情况下它会红                                         |
 * | ------------------------------------------- | -------------------------------------------------------- |
 * | `plan-ready` 里 `form=shared` 且**恰好一个**选择点 | 形态在 URL 上丢了、提示词没按要求长出岔路           |
 * | 闸门改的那一个字**进了 `book.json`**        | 改完没落盘、"就按这个画"没拿家长改的那一份（两份真相）    |
 * | 全树节点数 > 路长                            | 又按"表里有几个节点"报页数了（06 §三那条口径）            |
 * | 每一页都有图、选择点那三段都有音             | ②漏画了走不到的那一支 / 03 的三段配音没接上               |
 * | 选 b 之后 **a 支那一页的图一次都没被请求**   | 阅读顺序又变回"按页号平铺"（04 §一 那个活 bug 的形状）    |
 * | 读的全程 `/api/` **只有 GET**                | 阅读时又去生成/改故事了（预生成不是真的）                 |
 * | 关掉标签页另开一个，按下态还在                | 07 的落盘没接上（内存 state 也能做到"刷新前一致"）        |
 *
 * ## 三条与夹具版不同的地方
 *
 * 1. **书号不写死**：它由"卡 + 形态 + 主题"指纹决定，脚本把它打出来
 *    （想导出成演示书就是 `export-demo-book.mts --book=<它>`）。
 * 2. **跑第二遍会先删掉上一本**（同一个主题 = 同一个书号 = 同一个目录，
 *    而 `/api/books` 对已存在的书是 409——那是产品自己定的规矩：
 *    同一个主题做不出第二本）。删的是**这个一次性账号自己那一片**里的那一本，
 *    走的是真路由 `DELETE /api/books/<id>`。
 * 3. **夹具版里那些"缺图兜底纸"的判据不在这里**：这一趟跑的是真书，
 *    没有一页该缺图（`errors` 必须是空的）。那一档由 04 的 `--missing` 夹具守着。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeBookFrame, type BookStreamFrame } from '../src/lib/book-stream.ts'
import { createSseDecoder } from '../src/lib/engine/sse.ts'
import type { NodeDraft, PlanDraft } from '../src/lib/schemas/story.ts'
import { DEFAULT_VOICES } from '../src/lib/voices/state.ts'
import { arg } from './env.mts'

const BASE = arg('base', 'http://127.0.0.1:3311').replace(/\/+$/, '')
const ACCOUNT = arg('account', '13900000203')
const PASSWORD = 'yi-demo-0000'
const THEME = arg('theme', '云端的小路')
const PAGES = Number(arg('pages', '5'))
/**
 * `--until=story` 到第③步就停（编故事 + 闸门改字那两步验完，**一张图都不出**）。
 * ★ 它是给"改了这个脚本、先便宜地跑一遍"用的：前三步只花一次文本调用，
 *   而④那一步是整条链路里唯一真花钱的地方（7–8 张图 + 十来段音）。
 */
const UNTIL = arg('until', 'all')
const CHROME = arg('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
const CDP_PORT = Number(arg('cdp-port', '9349'))
const ROOT = resolve(arg('out', '.out/web'))
const PROFILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.out', 'chrome-e2e-shared')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rows: [string, string][] = []
let failed = 0
function check(what: string, ok: boolean, detail = ''): boolean {
  if (!ok) failed += 1
  rows.push([`${ok ? '✓' : '✗'} ${what}`, detail])
  console.log(`${ok ? '✓' : '✗'} ${what}${detail ? ` —— ${detail}` : ''}`)
  return ok
}

const realFetch = globalThis.fetch

/* ── ① 一个一次性账号（后端的短信是开发模式，验证码固定 123456） ─────────────── */

function remember(cookies: Map<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const [pair] = header.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) cookies.set(pair.slice(0, eq) ?? '', pair.slice(eq + 1))
  }
}

const cookieHeaderOf = (cookies: Map<string, string>): string =>
  [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')

async function authedPost(
  cookies: Map<string, string>,
  path: string,
  body: unknown,
): Promise<Response> {
  return realFetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookies.size > 0 ? { cookie: cookieHeaderOf(cookies) } : {}),
    },
    body: JSON.stringify(body),
  })
}

/**
 * 登录（或第一次跑时注册）。★ 与 `e2e-demo-cards.mts` 同一个做法，包括那一条
 * "先试密码登录、401 了才注册"：短信有频控，每跑一次都注册会把自己跑到 429。
 */
async function account(name: string): Promise<Map<string, string>> {
  const cookies = new Map<string, string>()
  const login = await authedPost(cookies, '/api/auth/login-password', {
    account: name,
    password: PASSWORD,
  })
  if (login.ok) {
    remember(cookies, login)
    return cookies
  }
  const sent = await authedPost(cookies, '/api/auth/send-code', { account: name })
  if (!sent.ok) throw new Error(`发验证码失败：HTTP ${sent.status}（频控？换个号或等一会儿）`)
  const verified = await authedPost(cookies, '/api/auth/verify-code', {
    account: name,
    code: '123456',
  })
  if (!verified.ok) throw new Error(`核验失败：HTTP ${verified.status}`)
  // ★ 这一步把**设密码那张票**放进罐子里（httpOnly，只能从 Set-Cookie 头拿）。
  //   漏了它，下一步就是 401——票根本没带上过
  remember(cookies, verified)
  const passworded = await authedPost(cookies, '/api/auth/set-password', { password: PASSWORD })
  if (!passworded.ok) throw new Error(`设密码失败：HTTP ${passworded.status}`)
  remember(cookies, passworded)
  return cookies
}

/* ── SSE 那条流在这里的最小读法（★ 解码器与浏览器是**同一个**） ─────────────── */

type StreamResult =
  | { ok: true; frames: BookStreamFrame[]; broken?: boolean }
  | { ok: false; status: number; text: string }

/**
 * ★ 解码器用的是 `engine/sse.ts` + `book-stream.ts` 那两件——脚本里再写一个松一点的
 *   解析，就会让"终端里看到的"与"屏幕上看到的"变成两份真相（`creation/api.ts`
 *   文件头第 3 条为同一件事付过学费）。这一层只是把请求与读循环摆出来。
 *
 * ★★ 走 `node:http` 而不是 `fetch`：**Node 那份 fetch（undici）默认 300 秒没有新字节
 *   就把连接掐了**（`bodyTimeout`），而这一条流在出图那一段本来就常常几分钟不吐一个字
 *   ——实测撞到过一次，报错是一句光秃秃的 `terminated`（看着像服务端崩了，其实是客户端
 *   自己走的）。`http.request` 没有这个默认值，而这里要的正是"一直等到它说完"。
 * ★ 流被掐断时**不抛**：把收到的帧原样交回去，让调用方按"这一轮有没有跑到头"判断
 *   （服务端那边有它自己的纪律：客户端断开 ≠ 后端停手，见 `/api/books` 文件头第 2 条）。
 */
function postStream(cookie: string, path: string, body: unknown): Promise<StreamResult> {
  const payload = JSON.stringify(body)
  const url = new URL(`${BASE}${path}`)
  return new Promise<StreamResult>((resolve) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          cookie,
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            text += chunk
          })
          response.on('end', () => resolve({ ok: false, status, text }))
          return
        }
        const frames: BookStreamFrame[] = []
        const decoder = createSseDecoder()
        const text = new TextDecoder()
        response.on('data', (chunk: Buffer) => {
          for (const sse of decoder.push(text.decode(chunk, { stream: true }))) {
            const frame = decodeBookFrame(sse)
            if (!frame) continue
            frames.push(frame)
            if (frame.kind === 'delta') process.stdout.write('.')
            if (frame.kind === 'fatal') console.log(`\n    fatal：${frame.code} ${frame.message}`)
            if (frame.kind === 'engine' && frame.event.kind === 'plan-ready') {
              const event = frame.event
              console.log(
                `    plan-ready：${event.nodeCount} 个节点、选择点在第 ${event.choicePages.join('/')} 页、` +
                  `form=${event.form ?? '(这一帧没带)'}`,
              )
            }
          }
        })
        response.on('end', () => resolve({ ok: true, frames }))
        response.on('aborted', () => resolve({ ok: true, frames, broken: true }))
      },
    )
    request.on('error', (err: Error) => resolve({ ok: false, status: 0, text: err.message }))
    request.end(payload)
  })
}

/**
 * 等这本书**装订完成**（`book.json` 落盘），最多等 `ms`。
 *
 * ★ 它存在的理由是一条产品上的约定：**客户端断开 ≠ 后端停手**（`/api/books` 文件头
 *   第 2 条）。所以"我这条流断了"与"这一轮没跑完"是两件事——断了之后要回头看盘上，
 *   而不是直接宣布失败。
 */
async function waitForBook(bookId: string, userId: string, ms = 6 * 60_000): Promise<boolean> {
  const manifest = join(ROOT, 'u', userId, 'books', bookId, 'book.json')
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (existsSync(manifest)) return true
    await sleep(5000)
  }
  return false
}

const engineEventsOf = (frames: BookStreamFrame[]) =>
  frames.flatMap((frame) => (frame.kind === 'engine' ? [frame.event] : []))

/** 收尾那一帧（它是"这一次跑在哪儿"的实况，不落盘）。`findLast` 手写：lib 里没有 */
function statusFrameOf(frames: BookStreamFrame[]) {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i]
    if (frame?.kind === 'status') return frame
  }
  return null
}

type Node = {
  nodeId: string
  pageNo: number
  body: string[]
  next: string[]
  pathFromRoot: string[]
  choice?: { prompt: string; options: { label: string }[] }
}

type Manifest = {
  bookId: string
  form: string
  tree: { form: string; rootId: string; nodes: Node[] }
  illustrations: { pageNo: number }[]
  narrations: { pageNo: number; part?: string }[]
  errors: unknown[]
}

/**
 * 一棵树里**从根到叶各有多长**（独立算一遍：只顺着 `next` 走，不读 `pathFromRoot`）。
 * ★ 独立算才有判别力——用同一份派生数据去核对自己，红不了。
 */
function pathLengthsOf(tree: Manifest['tree']): number[] {
  const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]))
  const ends: number[] = []
  const walk = (id: string, depth: number): void => {
    const node = byId.get(id)
    if (!node || node.next.length === 0) {
      ends.push(depth)
      return
    }
    for (const child of node.next) walk(child, depth + 1)
  }
  walk(tree.rootId, 1)
  return [...new Set(ends)].sort((a, b) => a - b)
}

/* ── 主流程 ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`打      ${BASE}`)
  console.log(`资产根  ${ROOT}\n`)

  console.log('① 账号')
  const cookies = await account(ACCOUNT)
  const cookie = cookieHeaderOf(cookies)
  const me = await realFetch(`${BASE}/api/auth/me`, { headers: { cookie } })
  const meBody = (await me.json()) as { user?: { userId?: string } }
  const userId = String(meBody.user?.userId ?? '')
  check('登录态通（`/api/auth/me` 200）', me.ok && userId !== '', `userId=${userId}`)

  // 有音色就用：这一趟顺带验 03 那三段（引导提问 + 两个选项）真的配上了。
  // ★ 两个来源，顺序是"先自己的、再预置的"：
  //   · `GET /api/voices` 回的是**这个账号克隆的那些**（新账号是空的）；
  //   · `DEFAULT_VOICES` 是**内置的两枚预置音色**（`lib/voices/state.ts`），不走账号，
  //     所以任何一个新账号也能用——界面上的选择器给的也是这几个。
  //   ★ 表直接 import 进来，不在这里抄一份 id：抄一份就会漂，而漂的症状是
  //     "脚本里那个音色供应商那边已经没了"（那是一条 404，看着像 TTS 坏了）。
  const voices = await realFetch(`${BASE}/api/voices`, { headers: { cookie } })
  const voiceBody: unknown = voices.ok ? await voices.json() : null
  const voiceId = firstVoiceId(voiceBody) || (DEFAULT_VOICES[0]?.id ?? '')
  console.log(`        音色 ${voiceId || '（一个都取不到：这一本不配音）'}`)

  console.log(`② 编故事（POST /api/books，form=shared、pages=${PAGES}）`)
  const body = {
    child: {
      childId: 'xiaoyu-e2e',
      name: '小宇',
      nameReading: 'xiǎo yǔ',
      ageBand: '4-6',
      lookTags: [],
      interestTags: [],
    },
    // 示例卡：每个人都能借（`withDemoCards`），所以这个一次性账号用得起
    cardId: 'xiaoyu-r1',
    theme: THEME,
    form: 'shared',
    pages: PAGES,
    ...(voiceId ? { voiceId } : {}),
  }

  let created = await postStream(cookie, '/api/books', body)
  if (!created.ok && created.status === 409) {
    // 同一个主题 = 同一个书号：上一次跑留下的那一本先删掉（走真路由）
    const exists = JSON.parse(created.text) as { extra?: { bookId?: string } }
    const old = exists.extra?.bookId ?? ''
    console.log(`        这个主题已经有一本了（${old}）——先删掉它再跑`)
    if (old !== '') {
      const cut = await realFetch(`${BASE}/api/books/${encodeURIComponent(old)}`, {
        method: 'DELETE',
        headers: { cookie },
      })
      check(`DELETE /api/books/${old} 删掉了上一本`, cut.ok, `HTTP ${cut.status}`)
    }
    created = await postStream(cookie, '/api/books', body)
  }
  if (!created.ok) {
    check(`编故事那一步通（HTTP ${created.status}）`, false, created.text.slice(0, 300))
    return
  }

  const ready = engineEventsOf(created.frames).find((event) => event.kind === 'plan-ready')
  const bookId = statusFrameOf(created.frames)?.bookId ?? ''
  check('这一轮没有 fatal 帧', !created.frames.some((frame) => frame.kind === 'fatal'))
  check(
    '★ `plan-ready` 说这一本是共读版，而且**恰好一个**选择点',
    Boolean(
      ready &&
      ready.kind === 'plan-ready' &&
      ready.form === 'shared' &&
      ready.choicePages.length === 1,
    ),
    ready && ready.kind === 'plan-ready'
      ? `form=${ready.form}、choicePages=${JSON.stringify(ready.choicePages)}、nodeCount=${ready.nodeCount}`
      : '（没有收到 plan-ready）',
  )
  check('收尾那一帧带着书号（闸门那一屏靠它去取故事）', bookId !== '', `bookId=${bookId}`)
  if (bookId === '') return

  console.log(`\n③ 闸门：改一个字，存回去（书号 ${bookId}）`)
  const storyRes = await realFetch(`${BASE}/api/books/${bookId}/story`, { headers: { cookie } })
  const story = ((await storyRes.json()) as { story?: PlanDraft }).story
  const nodes: NodeDraft[] = story?.nodes ?? []
  const choiceIndex = nodes.findIndex((node) => Boolean(node.ask))
  const labels = [nodes[choiceIndex]?.labelA, nodes[choiceIndex]?.labelB]
  check(
    '这一版故事里有一个完整的选择点（提问 + 两个选项）',
    Boolean(nodes[choiceIndex]?.ask && labels[0] && labels[1]),
    `第 ${choiceIndex + 1} 页：${JSON.stringify(labels)}`,
  )

  /**
   * ★ 改的那一处刻意选**第 1 页的正文**，而且加的是一句**能读的话**——
   *   两个理由各是各的：
   *   ① 第 1 页不走岔路也会读到，所以"改进了产物"这件事与选哪一支无关，判据干净；
   *   ② 这一本跑完会被**导出成演示书**（工单 08 §二，用户 2026-10-18 拍板用真跑那本），
   *      所以那句"验收专用"的话不能是一句会留在书上、印给孩子看的废话。
   *      判据要的是"我改的这一串字在不在产物里"，一串**能读的字**同样满足它。
   */
  const MARK = '小宇在云朵上停了一下，听见风从很远的地方吹过来。'
  if (!story || nodes.length === 0) {
    check('拿得到故事草稿（后面几步都要它）', false)
    return
  }
  const edited: PlanDraft = {
    ...story,
    nodes: nodes.map((node, index) =>
      index === 0 ? { ...node, body: [...node.body, MARK] } : node,
    ),
  }
  const saved = await realFetch(`${BASE}/api/books/${bookId}/story`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(edited),
  })
  check('PUT /story 存回去了', saved.ok, `HTTP ${saved.status}`)
  const again = await realFetch(`${BASE}/api/books/${bookId}/story`, { headers: { cookie } })
  const reread = ((await again.json()) as { story?: PlanDraft }).story
  check(
    '★ 再读回来，改的那一句还在（不是只在内存里改了一版）',
    Boolean(reread?.nodes[0]?.body.includes(MARK)),
    `第 1 页正文 ${reread?.nodes[0]?.body.length ?? 0} 句`,
  )

  if (UNTIL === 'story') {
    console.log(
      '\n（`--until=story`：到这儿停。编故事与闸门那两步验完了，' +
        '**没有出图、也没有配音**——④那一步是这一趟唯一真花钱的地方）',
    )
    return
  }

  console.log('\n④ 就按这个画（POST /api/books/<id>/illustrate，真出图真配音）')
  const started = Date.now()
  const drawn = await postStream(cookie, `/api/books/${bookId}/illustrate`, edited)
  console.log(`\n        用时 ${Math.round((Date.now() - started) / 1000)} 秒`)
  if (!drawn.ok) {
    check(`出图那一步通（HTTP ${drawn.status}）`, false, drawn.text.slice(0, 300))
    return
  }
  const fatal = drawn.frames.find((frame) => frame.kind === 'fatal')
  check(
    '出图这一轮没有 fatal 帧',
    !fatal,
    fatal && fatal.kind === 'fatal' ? `${fatal.code}：${fatal.message}` : '',
  )
  if (drawn.broken) {
    /*
     * ★ 流断了（服务端重启、代理掐线那一类）不等于这一轮没跑完：
     *   `/api/books` 的纪律是**客户端断开 ≠ 后端停手**，所以这里回头看盘上，
     *   最多再等 6 分钟。等得到就照常往下验——判据取的是**服务端的事实**，
     *   不是"我这条连接有没有活到最后"。
     */
    console.log('        （这一条流断了。回头看盘上：服务端那边可能还在跑）')
    check('流断之后，服务端仍然把这一本装订完了', await waitForBook(bookId, userId))
  }
  if (fatal) {
    /*
     * ★ 上游超时（HTTP 504 那一类）在这里**收摊**，不再往下读清单。
     *   那一轮死了就没有 `book.json`，硬读下去报出的是一句 `ENOENT`——
     *   而那句把"平台超时"说成了"文件不见"，下一个看日志的人会去查错的地方。
     *   ★ 这不是本项目能修的东西：真跑实测撞到过一次（第 8 页连试三次之后上游 504，
     *   前面 7 页与那些重画都好好画完了）。隔一会儿重跑，`--pages=` 调小命中率更高。
     */
    console.log('\n（上游那一轮失败了：这一本没有装订，后面的清单与阅读器判据这一趟不验）')
    return
  }

  const manifest = JSON.parse(
    await readFile(join(ROOT, 'u', userId, 'books', bookId, 'book.json'), 'utf8'),
  ) as Manifest
  const ends = pathLengthsOf(manifest.tree)
  const nodeCount = manifest.tree.nodes.length
  const pathLength = ends[ends.length - 1] ?? 0
  const choices = manifest.tree.nodes.filter((node) => node.choice)

  check('清单里这一本是共读版', manifest.form === 'shared', `form=${manifest.form}`)
  check('清单里恰好一个选择点', choices.length === 1, `${choices.length} 个`)
  check(
    '★ 全树节点数 > 路长（走不到的那一支真的多画了）',
    nodeCount > pathLength,
    `节点 ${nodeCount} 个、路长 ${ends.join('–')} 页`,
  )
  check(
    '★ 闸门改的那一句进了产物（画的是家长改过的那一份）',
    manifest.tree.nodes.some((node) => node.body.includes(MARK)),
    MARK,
  )
  check(
    '每一页都有图，而且没有一页是硬失败',
    manifest.illustrations.length === nodeCount && manifest.errors.length === 0,
    `图 ${manifest.illustrations.length} 张 / 页 ${nodeCount} 个 / errors ${manifest.errors.length}`,
  )
  if (voiceId !== '') {
    const parts = new Set(manifest.narrations.map((one) => one.part ?? 'body'))
    check(
      '★ 选择点那三段都配上了音（03：引导提问 + 两个选项）',
      parts.has('prompt') && parts.has('option-a') && parts.has('option-b'),
      `有音的片段：${[...parts].sort().join(', ')}`,
    )
  } else {
    console.log('  （一个音色都取不到，三段配音这一条这一趟验不了——不是失败）')
  }

  /* ── ⑤ 阅读器：真浏览器，判据在网络与"真销毁"上 ───────────────────────────── */

  console.log('\n⑤ 阅读器（无头 Chrome；判据在网络与"真销毁"上）')
  const choice = choices[0]
  const headA = choice?.next[0] ?? ''
  const headB = choice?.next[1] ?? ''
  const pagesUnder = (head: string): number[] =>
    head === ''
      ? []
      : manifest.tree.nodes
          .filter((node) => node.pathFromRoot.includes(head))
          .map((node) => node.pageNo)
  const aPages = pagesUnder(headA)
  const bPages = pagesUnder(headB)
  /** ★ 底栏那个「第 k 页」是**这条路上的第几屏**（04 §三），而 `pathFromRoot` **含自己**
   *  ——所以选择点那一屏的序号就是它的路径长度（07 的夹具实测：选择点在第 3 页 → 「第 3 页」）*/
  const choiceScreen = choice?.pathFromRoot.length ?? 0

  await rm(PROFILE, { recursive: true, force: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,900',
    'about:blank',
  ])

  try {
    const version = (await waitJson(`http://127.0.0.1:${CDP_PORT}/json/version`)) as {
      webSocketDebuggerUrl?: string
    }
    const browserSocket = new WebSocket(String(version.webSocketDebuggerUrl))
    await new Promise((r) => (browserSocket.onopen = r))
    const browserSend = connect(browserSocket)

    async function openTab(label: string): Promise<Tab> {
      const created2 = await browserSend('Target.createTarget', { url: 'about:blank' })
      const targetId = created2.result?.targetId ?? ''
      let socketUrl = ''
      for (let i = 0; i < 40 && socketUrl === ''; i += 1) {
        const list = (await waitJson(`http://127.0.0.1:${CDP_PORT}/json`)) as {
          id?: string
          webSocketDebuggerUrl?: string
        }[]
        socketUrl = list.find((item) => item.id === targetId)?.webSocketDebuggerUrl ?? ''
        if (socketUrl === '') await sleep(100)
      }
      if (socketUrl === '') throw new Error('新标签页没接上')
      const socket = new WebSocket(socketUrl)
      await new Promise((r) => (socket.onopen = r))
      const send = connect(socket)
      const tab: Tab = {
        label,
        targetId,
        assets: [],
        apiCalls: [],
        exceptions: [],
        send,
        async evaluate(expression: string) {
          const res = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
          })
          if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
          return res.result?.result?.value
        },
      }
      socket.addEventListener('message', (event) => {
        const msg = parseCdp(event)
        if (msg.method === 'Network.requestWillBeSent') {
          const url = msg.params?.request?.url ?? ''
          const method = msg.params?.request?.method ?? ''
          if (url.includes('/api/assets/')) tab.assets.push(decodeURIComponent(url))
          if (url.includes('/api/'))
            tab.apiCalls.push(`${method} ${url.slice(url.indexOf('/api/'))}`)
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          tab.exceptions.push(msg.params?.exceptionDetails?.text ?? '(没有说明)')
        }
      })
      for (const method of ['Network.enable', 'Runtime.enable', 'Page.enable']) await send(method)
      // ★ 会话票走 CDP 塞进去（`httpOnly` 挡的是 JS，挡不住这一层）
      await send('Network.setCookie', {
        name: 'xzj_session',
        value: cookies.get('xzj_session') ?? '',
        url: BASE,
      })
      return tab
    }

    const readerUrl = `${BASE}/reader/${bookId}`
    const tab1 = await openTab('趟 1')
    await tab1.send('Page.navigate', { url: readerUrl })
    check(
      '运行期那本书能在阅读器里打开（带着自己那张票）',
      await waitFor(
        tab1,
        `document.readyState === 'complete' && !!document.querySelector('.reader__readout')`,
      ),
    )

    const onChoice = await flipTo(tab1, `第 ${choiceScreen} 页`)
    const settled = await waitFor(tab1, `!!document.querySelector('.book-choice[data-on]')`)
    const onScreen = await labelsOf(tab1)
    check(
      '★ 屏幕上那个岔口就是这一版故事里的那两个选项（生成 → 界面这条链是通的）',
      onChoice && settled && onScreen.join('｜') === labels.join('｜'),
      `屏幕上 ${JSON.stringify(onScreen)}／故事里 ${JSON.stringify(labels)}`,
    )

    await pick(tab1, 1)
    const advanced = await waitFor(
      tab1,
      `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === ${JSON.stringify(`第 ${choiceScreen + 1} 页`)}`,
    )
    const fetched = assetsOn(tab1)
    const hitA = aPages.some((pageNo) => fetched.some((url) => url.includes(`page-${pageNo}-`)))
    const hitB = bPages.some((pageNo) => fetched.some((url) => url.includes(`page-${pageNo}-`)))
    check('按下 b 之后翻到了这条路的下一屏', advanced)
    check(
      '★★ a 支那一页的图**一次都没被请求**（取到的是 b 支的页）',
      !hitA && hitB,
      `a 支第 ${aPages.join('/')} 页、b 支第 ${bPages.join('/')} 页；共取过 ${fetched.length} 个资产`,
    )
    const writes = tab1.apiCalls.filter((call) => !call.startsWith('GET '))
    check(
      '★★ 读的全程 `/api/` 只有 GET（阅读器不生成任何东西——预生成是真的）',
      writes.length === 0,
      `这一趟 ${tab1.apiCalls.length} 条，非 GET ${writes.length} 条${writes.length ? `：${writes.join('、')}` : ''}`,
    )

    // ★ 真销毁：关掉这个标签页，另开一个（新的 JS 上下文、新的 React 树）
    await browserSend('Target.closeTarget', { targetId: tab1.targetId })
    await sleep(300)
    const tab2 = await openTab('趟 2')
    await tab2.send('Page.navigate', { url: readerUrl })
    await waitFor(
      tab2,
      `document.readyState === 'complete' && !!document.querySelector('.reader__readout')`,
    )
    await flipTo(tab2, `第 ${choiceScreen} 页`)
    await waitFor(tab2, `!!document.querySelector('.book-choice[data-on]')`)
    const pressed = await tab2.evaluate(
      `[...document.querySelectorAll('.book-choice__btn')].map((b) => b.getAttribute('aria-pressed'))`,
    )
    check(
      '★★ 真销毁之后回来：没点过任何东西，b 已经按着（07 的落盘接上了）',
      Array.isArray(pressed) && pressed[1] === 'true',
      JSON.stringify(pressed),
    )
    check(
      '这两趟都没有 JS 异常',
      tab1.exceptions.length === 0 && tab2.exceptions.length === 0,
      [...tab1.exceptions, ...tab2.exceptions].join('｜'),
    )

    console.log('\n产物')
    console.log(`  bookId      ${bookId}`)
    console.log(
      `  形态        shared · 选择点在第 ${choice?.pageNo} 页（那是第 ${choiceScreen} 屏）`,
    )
    console.log(
      `  页         路长 ${ends.join('–')} 页 / 全树 ${nodeCount} 个节点 / ${manifest.illustrations.length} 张图`,
    )
    console.log(`  想当演示书  node scripts/export-demo-book.mts --book=${bookId}`)
  } finally {
    chrome.kill()
  }
}

/* ── CDP 小工具（与 `chk-path-memory.mjs` 同一套手感，只留用得到的） ─────────── */

type CdpReply = {
  result?: {
    result?: { value?: unknown }
    exceptionDetails?: { text?: string }
    targetId?: string
  }
}

type CdpMessage = {
  id?: number
  method?: string
  params?: {
    request?: { url?: string; method?: string }
    exceptionDetails?: { text?: string }
  }
}

const parseCdp = (event: MessageEvent): CdpMessage => JSON.parse(String(event.data)) as CdpMessage

function connect(socket: WebSocket): (method: string, params?: unknown) => Promise<CdpReply> {
  let id = 0
  const pending = new Map<number, (msg: CdpReply) => void>()
  socket.addEventListener('message', (event) => {
    const msg = parseCdp(event)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)?.(msg as CdpReply)
      pending.delete(msg.id)
    }
  })
  return (method: string, params: unknown = {}) =>
    new Promise<CdpReply>((resolve) => {
      id += 1
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
}

async function waitJson(url: string): Promise<unknown> {
  for (let i = 0; i < 40; i += 1) {
    try {
      return await (await realFetch(url)).json()
    } catch {
      await sleep(250)
    }
  }
  throw new Error(`连不上 ${url}`)
}

type Tab = {
  label: string
  targetId: string
  assets: string[]
  apiCalls: string[]
  exceptions: string[]
  send: (method: string, params?: unknown) => Promise<CdpReply>
  evaluate: (expression: string) => Promise<unknown>
}

/** 后端那份音色表包在哪一层由它定：这一层只找第一个带 `voiceId` 的对象 */
function firstVoiceId(raw: unknown): string {
  const seen: unknown[] = [raw]
  while (seen.length > 0) {
    const item = seen.shift()
    if (Array.isArray(item)) seen.push(...item)
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record['voiceId'] === 'string' && record['voiceId'] !== '')
        return record['voiceId']
      seen.push(...Object.values(record))
    }
  }
  return ''
}

const assetsOn = (tab: Tab): string[] => [...new Set(tab.assets)]

async function waitFor(tab: Tab, expression: string, ms = 20000, step = 150): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await tab.evaluate(expression)) return true
    await sleep(step)
  }
  return false
}

async function clickBox(tab: Tab, selector: string, index = 0): Promise<boolean> {
  const box = (await tab.evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)) as { x: number; y: number } | null
  if (!box) return false
  for (const type of ['mousePressed', 'mouseReleased']) {
    await tab.send('Input.dispatchMouseEvent', {
      type,
      x: box.x,
      y: box.y,
      button: 'left',
      clickCount: 1,
    })
  }
  return true
}

const clickAt = (tab: Tab, selector: string): Promise<boolean> => clickBox(tab, selector)

/** 翻到某一屏：等的是底栏那个「第 k 页」变成它——补间走完才算到位，sleep 代替不了 */
async function flipTo(tab: Tab, label: string, times = 8): Promise<boolean> {
  for (let i = 0; i < times; i += 1) {
    const now = await readoutOf(tab)
    if (now === label) return true
    await clickAt(tab, '[aria-label="下一页"]')
    if (
      await waitFor(
        tab,
        `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() === ${JSON.stringify(label)}`,
        6000,
      )
    ) {
      return true
    }
  }
  console.log(`  （翻到「${label}」没成，停在「${await readoutOf(tab)}」）`)
  return false
}

const readoutOf = (tab: Tab): Promise<unknown> =>
  tab.evaluate(
    `document.querySelector('.reader__readout')?.firstChild?.textContent?.trim() ?? null`,
  )

const pick = (tab: Tab, index: number): Promise<boolean> =>
  clickBox(tab, '.book-choice__btn', index)

const labelsOf = (tab: Tab) =>
  tab.evaluate(
    `[...document.querySelectorAll('.book-choice__label')].map((el) => el.textContent.trim())`,
  ) as Promise<string[]>

/* ── 收尾 ────────────────────────────────────────────────────────────────── */

try {
  await main()
} catch (err) {
  check('跑完（没有抛出去的异常）', false, err instanceof Error ? err.message : String(err))
}

console.log(`\n${rows.length - failed}/${rows.length} 条通过`)
if (failed > 0) {
  console.log('红的是：')
  for (const [what, detail] of rows.filter((row) => row[0].startsWith('✗'))) {
    console.log(`  ${what}${detail ? ` —— ${detail}` : ''}`)
  }
}
process.exit(failed === 0 ? 0 : 1)
