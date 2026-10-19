/**
 * e2e-demo-cards.mts —— 示例角色卡**对每个人都有、而别人的东西拿不到**（工单 03 + 16）
 *
 * ```bash
 * node scripts/e2e-demo-cards.mts                        # 打 127.0.0.1:3311（隔离的那台）
 * node scripts/e2e-demo-cards.mts --base=http://127.0.0.1:3000
 * ```
 *
 * ★ 前提：那台 Next 的 BFF 与它在用的后端都得活着（登录要过它）。
 *   ★ 只打本机：会建**两个一次性账号**（短信是开发模式，验证码固定 123456）。
 *
 * 四组判据，每组都要**只有真做了才会不一样**：
 *
 * ① **看得见**：一个全新账号打开 `/api/children` 与 `/api/cards`，
 *    两张示例卡（小满 / 小宇）在里面——不只是卡墙，"选小主角"的选择器也在。
 *    参考图走 `GET /api/assets/cards/<卡号>/ref.<指纹>.jpg`（200、字节数与卡里记的
 *    一致），`?w=240` 是真缩出来的一张 webp。
 *
 * ② **用得上**（这条才是"能用"的分水岭）：示例卡借给 B 当参考图的那条路通不通，
 *    交给单元测试（`card-source.test.ts` 走生产那条 store 组合）；
 *    这里钉的是 HTTP 面上的隔离——
 *
 * ③ **拿不到**：往 B 的那一片里放一张**只在 B 那一片**的卡（走 `cardStore.create`
 *    真写一版），然后 A 打同一个路径 → 404，B 打 → 200。这一对在"过滤式实现"
 *    与"结构性归属"下都绿不了前一半——归属没做，A 也能 200。
 *
 * ④ ★ **访客（没有登录的人）看得见示例、也只看得见示例**（2026-10-18 加的那一组）：
 *    匿名 `/character` 里画着示例卡，地址是 `/demo/cards/…` 那一族**静态**文件
 *    （所以顺带钉住"走的是静态那条路"——运行期的地址对匿名是 401）。
 *    匿名点得开 `/character/xiaoman`；而打**别人的**孩子 id（`kid-private-probe`，
 *    它真的存在）→ 404。"换地址不松鉴权"由①那条"匿名 /api/assets → 401"守在原地。
 *    ★ 同一天补的第二处：匿名 `/home` 那颗「小主角」药丸里也是**这两个孩子**
 *    （改之前那里写着「还没有小主角 · 先去建一个」，与角色墙互相打脸）。
 *
 * ★ 顺带念一句已知的代价：`?w=240` 那一张缩略图会缓存进**请求者**那一片
 *   （`u/<id>/thumbs/...`）。它是派生物，脚本把它数出来——不是失败，是"说了会有"。
 */

import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { cardDigest, createCardStore, createFsStore } from '../src/lib/engine/index.ts'
import { userSliceRoot } from '../src/lib/asset-scope.ts'
import { arg } from './env.mts'

const BASE = arg('base', 'http://127.0.0.1:3311')
const ROOT = resolve(arg('out', '.out/web'))

type Row = [what: string, value: string]
const rows: Row[] = []
let failed = 0

/** 断言记进表里，红的把整条念出来 */
function check(what: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1
  rows.push([`${ok ? '✓' : '✗'} ${what}`, detail])
}

/** 每个账号一个独立的 cookie 罐（模拟的是两台不同的设备） */
function remember(cookies: Map<string, string>, response: Response): void {
  for (const header of response.headers.getSetCookie?.() ?? []) {
    const [pair] = header.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
}

const cookieHeaderOf = (cookies: Map<string, string>): string =>
  [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')

async function post(cookies: Map<string, string>, path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookies.size > 0 ? { cookie: cookieHeaderOf(cookies) } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function get(cookie: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
}

/**
 * 建一个一次性账号（或者**接着用上一次那两个**），回它的 cookie 罐。
 *
 * ★ 先试密码登录，401 了才走三步注册：短信那条路有**频控**（docs/known-tradeoffs.md），
 *   而这个脚本一跑就要两个账号——每跑一次都烧一次额度，跑到第三次就 429 了
 *   （2026-10-17 实测撞上）。账号号是**写死的**，所以第二次起就是纯登录。
 * ★ 三步注册走的是浏览器同一条路（发码 → 核验 → 设密码），不是后门；
 *   短信是开发模式，验证码固定 123456。
 */
async function account(account: string): Promise<Map<string, string>> {
  const cookies = new Map<string, string>()
  const PASSWORD = 'yi-demo-0000'

  const login = await post(cookies, '/api/auth/login-password', { account, password: PASSWORD })
  if (login.ok) {
    remember(cookies, login)
  } else {
    const sent = await post(cookies, '/api/auth/send-code', { account })
    if (!sent.ok) throw new Error(`发验证码失败：HTTP ${sent.status}（频控？换个号或等一会儿）`)

    const verified = await post(cookies, '/api/auth/verify-code', { account, code: '123456' })
    if (!verified.ok) throw new Error(`核验失败：HTTP ${verified.status}`)
    // ★ 这一步把**设密码用的那张票**放进罐子里（httpOnly，所以只能从 Set-Cookie 头拿）。
    //   漏了这一句的症状是下一步 401——票根本没带上过
    remember(cookies, verified)
    const verdict = (await verified.json()) as { kind?: string }
    if (verdict.kind !== 'needs-password') throw new Error(`老用户？kind=${verdict.kind}`)

    const passworded = await post(cookies, '/api/auth/set-password', { password: PASSWORD })
    if (!passworded.ok) throw new Error(`设密码失败：HTTP ${passworded.status}`)
    remember(cookies, passworded)
  }

  const me = await get(cookieHeaderOf(cookies), '/api/auth/me')
  if (!me.ok) throw new Error(`登录态不通（APP_JWT_SECRET 两边不一致？）：HTTP ${me.status}`)
  return cookies
}

/** B 的 userId（从它自己的 /api/auth/me 拿，不猜） */
async function userIdOf(cookie: string): Promise<string> {
  const me = await get(cookie, '/api/auth/me')
  const body = (await me.json()) as { user?: { userId?: string } }
  const id = body.user?.userId
  if (!id) throw new Error('/api/auth/me 没有回 userId')
  return String(id)
}

async function sizeUnder(prefix: string): Promise<number> {
  const full = resolve(ROOT, prefix)
  if (!existsSync(full)) return 0
  let n = 0
  for (const name of await readdir(full, { recursive: true })) {
    const info = await stat(join(full, name)).catch(() => null)
    if (info?.isFile()) n += 1
  }
  return n
}

async function main(): Promise<void> {
  console.log(`打      ${BASE}（隔离的那台：NEXT_DIST_DIR=.next-session）`)
  console.log(`资产根  ${ROOT}\n`)

  // ── ① 两个账号（第一次跑会注册，之后都是登录）─────────────────────────────
  // 号可以换：`--a=139… --b=139…`（注册一次要两次短信额度，频控扛不住反复注册）
  const bNumber = arg('b', '13900000201')
  const aNumber = arg('a', '13900000202')
  const b = { account: bNumber, cookies: await account(bNumber) }
  const a = { account: aNumber, cookies: await account(aNumber) }
  const bCookie = cookieHeaderOf(b.cookies)
  const aCookie = cookieHeaderOf(a.cookies)
  console.log(`账号    B=${b.account}（userId ${await userIdOf(bCookie)}）`)
  console.log(`        A=${a.account}（userId ${await userIdOf(aCookie)}）\n`)

  // ── ② 看得见 ────────────────────────────────────────────────────────────
  const cards = await get(bCookie, '/api/cards')
  const cardBody = cards.ok
    ? ((await cards.json()) as { cards?: { cardId: string; referenceUrl: string }[] })
    : null
  const ids = new Set((cardBody?.cards ?? []).map((card) => card.cardId))
  check(
    '新账号的 /api/cards 里有两张示例卡',
    ids.has('xiaoman-r1') && ids.has('xiaoyu-r1'),
    `实际 ${ids.size} 张：${[...ids].sort().join(' ')}`,
  )
  check('别人的卡不在（u/1 那张 kid-yl957g-sheet 是账号 123456 的）', !ids.has('kid-yl957g-sheet'))

  const children = await get(bCookie, '/api/children')
  const childBody = children.ok
    ? ((await children.json()) as {
        children?: { childId: string; card: { thumbUrl: string } | null }[]
      })
    : null
  const withCard = (childBody?.children ?? []).filter((item) => item.card !== null)
  check(
    '新账号的 /api/children 里示例孩子有形象',
    withCard.length === 2 && withCard.every((item) => ['xiaoman', 'xiaoyu'].includes(item.childId)),
    `${withCard.length} 个有形象：${withCard.map((item) => item.childId).join(' ')}`,
  )

  const refUrl = (cardBody?.cards ?? []).find((card) => card.cardId === 'xiaoman-r1')?.referenceUrl
  const original = refUrl ? await get(bCookie, refUrl) : null
  const refBytes = original ? (await original.arrayBuffer()).byteLength : 0
  check(
    '参考图原图读得到（字节数与卡里记的一致）',
    original?.status === 200 && refBytes === 327226,
    `HTTP ${original?.status} · ${refBytes} 字节`,
  )

  const thumb = refUrl ? await get(bCookie, `${refUrl}?w=240`) : null
  const thumbBytes = thumb ? (await thumb.arrayBuffer()).byteLength : 0
  check(
    '?w=240 是真缩出来的一张（webp，比原图小）',
    thumb?.status === 200 &&
      (thumb.headers.get('content-type') ?? '').includes('webp') &&
      thumbBytes < refBytes,
    `HTTP ${thumb?.status} · ${thumbBytes} 字节`,
  )

  // ── ③ 拿不到 ────────────────────────────────────────────────────────────
  // 往 B 的那一片里放一张只在 B 那一片的卡（走引擎真写，不是手拼文件）
  const bUserId = await userIdOf(bCookie)
  const store = await createFsStore(userSliceRoot(ROOT, bUserId))
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const mine = await createCardStore(store).create({
    cardId: 'private-probe-sheet',
    childId: 'kid-private-probe',
    anchors: [
      { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
      { slot: 'eyes', value: '深棕圆眼' },
      { slot: 'hair', value: '黑发偏软，左上方翘着一撮' },
      { slot: 'build', value: '头身比约 1:4' },
      { slot: 'skin', value: '暖黄偏深的肤色' },
    ],
    style: '温暖手绘绘本插画：水彩铺色打底',
    referenceBytes: png,
    referenceMime: 'image/png',
    modelId: 'probe',
    promptVersion: 'character-sheet@v2',
    now: Date.now(),
  })
  const privatePath = `cards/private-probe-sheet/r1.${cardDigest(mine.card)}.json`

  const bSees = await get(bCookie, `/api/assets/${privatePath}`)
  const aSees = await get(aCookie, `/api/assets/${privatePath}`)
  check('B 打自己那一片的卡 → 200', bSees.status === 200, `HTTP ${bSees.status}`)
  check('★ A 打 B 那一片的同一个路径 → 404', aSees.status === 404, `HTTP ${aSees.status}`)

  const anon = await get('', `/api/assets/${privatePath}`)
  check('匿名 → 401', anon.status === 401, `HTTP ${anon.status}`)

  // ── ⑤ 访客（没有登录的人）：看得见示例、也只看得见示例 ──────────────────
  //
  // ★ 2026-10-18 加的这一组。用户："对于没有登录的人，那两个默认角色卡也是可以看见的。"
  //   判据取**渲染出来的 img 地址 + 那个地址真的出图**，与上面登录那一组同一个手法：
  //   "页面 200"分不出"两张有图的卡"与"两张空相纸"。
  // ★ 地址必须是 `/demo/cards/…` 那一族（public/ 下的静态文件）：
  //   运行期的地址对匿名是 401，所以这一条同时钉住了"走的是静态那条路"。
  //   ★ 上面那条"匿名 /api/assets → 401"一个字都没动：换的是地址，不是鉴权。
  const anonWall = await get('', '/character')
  const anonWallText = anonWall.ok ? await anonWall.text() : ''
  const anonSrc = anonWallText.match(/\/demo\/cards\/[a-z]+-r1\/ref\.[0-9a-f]+\.webp/)
  const anonDrawn = anonSrc ? await get('', anonSrc[0]) : null
  check(
    '匿名 /character 里画着示例卡，地址走 /demo/cards/ 静态那一族',
    anonWall.status === 200 && Boolean(anonSrc),
    `HTTP ${anonWall.status} · ${anonSrc?.[0] ?? '页面里没找到 /demo/cards/ 的 img'}`,
  )
  check(
    '匿名请求那张图 → 200 且是 webp（预生成的兄弟文件，不是 327 KB 的原图）',
    anonDrawn?.status === 200 && (anonDrawn.headers.get('content-type') ?? '').includes('webp'),
    `HTTP ${anonDrawn?.status} · ${anonDrawn?.headers.get('content-type') ?? ''}`,
  )

  const anonDetail = await get('', '/character/xiaoman')
  const anonDetailText = anonDetail.ok ? await anonDetail.text() : ''
  const anonDetailSrc = anonDetailText.match(/\/demo\/cards\/xiaoman-r1\/ref\.[0-9a-f]+\.webp/)
  const anonDetailArt = anonDetailSrc ? await get('', anonDetailSrc[0]) : null
  check(
    '匿名点得开示例孩子的形象页，而且那一页的图也出得来',
    anonDetail.status === 200 && Boolean(anonDetailSrc) && anonDetailArt?.status === 200,
    `HTTP ${anonDetail.status} · ${anonDetailSrc?.[0] ?? '页面里没找到示例卡的 img'} → ${anonDetailArt?.status}`,
  )
  // ★ 判据选 `kid-private-probe`（B 刚建的那个孩子，**它真的存在**）：
  //   换一个不存在的 id 时 404 是废话，只有"存在但不属于访客"才说明归属是结构性的
  const anonStranger = await get('', '/character/kid-private-probe')
  check(
    '★ 匿名打别人的孩子 id → 404（它存在，只是不在访客那一支的根底下）',
    anonStranger.status === 404,
    `HTTP ${anonStranger.status}`,
  )

  // ★ 匿名 `/home`：这颗药丸是 2026-10-18 补的第二处。改之前它写着
  //   「还没有小主角 · 先去建一个」，而同一个访客在 `/character` 上明明看得见小满 / 小宇
  //   ——两屏对**同一件事实**给了两种说法。判据取三样一起，因为它们各自能单独坏掉：
  //   名字（药丸上写的是名字，键拿错就显示卡号）、静态地址（落回 /api/assets 就是 401）、
  //   以及**那句假话必须消失**（它是这次改动的反面，只有真改到才会不见）。
  const anonHome = await get('', '/home')
  const anonHomeText = anonHome.ok ? await anonHome.text() : ''
  const anonHomeSrc = anonHomeText.match(/\/demo\/cards\/[a-z]+-r1\/ref\.[0-9a-f]+\.webp/)
  const anonHomeArt = anonHomeSrc ? await get('', anonHomeSrc[0]) : null
  check(
    '★ 匿名 /home 那颗「小主角」药丸里是示例那两个孩子（有名字、也有图）',
    anonHome.status === 200 &&
      anonHomeText.includes('小满') &&
      Boolean(anonHomeSrc) &&
      anonHomeArt?.status === 200,
    `HTTP ${anonHome.status} · 名字${anonHomeText.includes('小满') ? '在' : '不在'} · ` +
      `${anonHomeSrc?.[0] ?? '页面里没找到 /demo/cards/ 的 img'} → ${anonHomeArt?.status}`,
  )
  check(
    '匿名 /home 上不再写「还没有小主角」（那句话现在与角色墙互相打脸）',
    anonHome.status === 200 && !anonHomeText.includes('还没有小主角'),
    `HTTP ${anonHome.status}`,
  )

  // ── ⑥ 界面上真的画出来了 ────────────────────────────────────────────────
  // ★ 判据取**渲染出来的 HTML 里那个 img 地址**，再去请求它。
  //   只看"页面 200"是看不出问题的（一个 `<img>` 指向 404 的页也 200）；
  //   只看 `listChildItems` 那就还停在单元测试那一层。
  for (const [page, what] of [
    ['/character', '角色墙'],
    ['/home', '创作首页'],
  ] as const) {
    const html = await get(bCookie, page)
    const text = html.ok ? await html.text() : ''
    const src = text.match(
      /\/api\/assets\/cards\/xiaoman-r1\/ref\.[0-9a-f]+\.(?:jpg|webp)(?:\?w=\d+)?/,
    )
    const drawn = src ? await get(bCookie, src[0]) : null
    check(
      `${what} ${page} 里画着示例卡那张图，而且那个地址真的出图`,
      html.status === 200 && Boolean(src) && drawn?.status === 200,
      `HTTP ${html.status} · ${src?.[0] ?? '页面里没找到示例卡的 img'} → ${drawn?.status}`,
    )
  }

  // ── ⑦ 垫底层是只读的：示例卡不该被抄进谁的那一片 ─────────────────────────
  const bCards = await sizeUnder(`u/${bUserId}/cards`)
  check(
    '示例卡没有落进 B 的那一片（B 的 cards/ 里只有刚造的那张探针卡）',
    bCards === 3,
    `${bCards} 个文件（探针卡：r1.json + latest + ref）`,
  )

  const width = Math.max(...rows.map(([what]) => [...what].length))
  console.log(
    rows
      .map(
        ([what, value]) =>
          `  ${what}${' '.repeat(Math.max(1, width - [...what].length))}  ${value}`,
      )
      .join('\n'),
  )

  // ── 念一句已知的代价（不是失败）──────────────────────────────────────────
  const thumbs = await sizeUnder(`u/${bUserId}/thumbs`)
  console.log(
    `\n  注：示例卡的缩略图缓存进了 B 那一片（u/${bUserId}/thumbs，${thumbs} 个文件）。` +
      `\n      它是派生物、不是作品，管理页那一列按目录名数，不会把它算成人家的书或卡。`,
  )

  if (failed > 0) {
    console.log(`\n✗ ${failed} 条没过`)
    process.exitCode = 1
    return
  }
  console.log('\n示例卡对每个人都有、别人的东西拿不到 ✓')
}

await main()
