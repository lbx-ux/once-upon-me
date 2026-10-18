/**
 * export-demo-cards.mts —— 把两张示例角色卡导出成**随仓库提交的演示资产**
 *
 * ```bash
 * node scripts/export-demo-cards.mts --from=.out/web/u/1                 # 列出来，不动盘
 * node scripts/export-demo-cards.mts --from=.out/web/u/1 --apply         # 真导出
 * node scripts/export-demo-cards.mts --from=.out/web/u/1 --card=xiaoman-r1 --apply
 * ```
 *
 * ★ 为什么是**整目录复制**、一个路径都不翻译：`card-source.ts` 把垫底层的根取在
 *   `public/demo/`，于是逻辑路径 `cards/<卡号>/x` 在演示那边**逐字相同**。
 *   `export-demo-book.mts` 要 `assetPathInDemo` 摘一次 `books/<id>/` 前缀，这里不用——
 *   布局两边一样，导出就是 `cp -r`。少一次翻译就少一处会漂的地方。
 *
 * ★ 导出的东西**不含任何密钥**，参考图是**合成**的（`make-demo-cards.mts` 的文件头：
 *   演示与答辩现场不需要任何真孩子的照片）。所以它与 `public/demo/children/`
 *   同一个口径：随仓库公开。
 *   ★ 但它**确实是公开的**：`public/` 是静态目录，`r1.<指纹>.json` 能被任何人不登录
 *   下载到（里面有锚点、`modelId`、`promptFragment`）。这三样界面上本来就看得见，
 *   所以这不是泄漏；写在这里是因为"放进 public 就等于公开"这件事要有人明说过一次。
 *
 * ## 每张参考图会多一个 `.webp` 兄弟文件（768 档，2026-10-18）
 *
 * 访客（未登录）看到的那两张示例卡走**静态地址**（`public/demo/cards/…`，Next 直接发），
 * 而静态文件挂不了 `?w=`——挂上去会静悄悄回原图（一个骗人的优化比不优化更糟），
 * 所以导出时预生成一份小的：768 档，卡片墙（显示 372 CSS px）与形象页用的都是这一档。
 * 运行期由 `card-source.ts` 的 `demoCardPathInPublic` 在"有兄弟文件"时优先用它。
 * ★ 原图留在目录里：卡里 `reference.path` 指的就是它，小的那份只是给人看的那一层。
 * ★ 生成那一段与演示书共用 `webp-siblings.mts`（两边只差扩展名与档位两个参数）。
 *
 * ★ 导出之后**逐条自检**，判据与 `export-demo-book` 那条同源（"清单里指的每一张图
 *   必须在盘上"），只是这里清单换成了卡：
 *   ① `latest` 指的那一版文件在不在；② 每一版的 `reference.path` 在不在；
 *   ③ 参考图名里的指纹与卡里记的 `reference.digest` 一致不一致
 *   （对不上说明复制过程动过文件名，而"这张图是哪一版卡的"就此答不上来）；
 *   ④ 每一版的参考图有没有 `.webp` 兄弟文件
 *   （少了它，访客那一屏会去拉 327 KB 的原图——而那一屏是评委第一眼看的地方）。
 *   红一条就退出码 1 并把那条念出来。
 */

import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { DEMO_CARDS_DIR, DEMO_ROOT, demoCardSiblingNames } from '../src/lib/card-source.ts'
import { THUMB_QUALITY } from '../src/lib/thumbs.ts'
import { arg, readEnv } from './env.mts'
import { writeWebpSiblings } from './webp-siblings.mts'

/**
 * 预生成的 `.webp` 兄弟文件取哪一档。
 *
 * ★ 768 是 `thumbs.ts` 那五个档里的"卡片墙"那一档（显示 372 CSS px × 2 倍屏 = 744），
 *   而形象页那一张大图用的也是它——**访客路径的两个消费者都要这一档**，
 *   所以只生成这一档就够。★ 名字里不带档位（与演示书那套一样）：
 *   换档位要重新导出，这一点两个脚本相同。
 */
const CARD_FACE_WIDTH = 768

/** 卡文件里我们要看的那几个数（不是整张卡，多余的字段不参与判断） */
type CardJson = {
  cardId: string
  revision: number
  reference: { path: string; digest: string; bytes: number }
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`

const nameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  let total = 0
  for (const item of await readdir(path, { withFileTypes: true })) {
    total += await sizeOf(join(path, item.name))
  }
  return total
}

/** `--card=a --card=b` 可以给多次；一个都不给就是"这个根下有的全要" */
function cardsWanted(): string[] {
  return process.argv
    .filter((item) => item.startsWith('--card='))
    .map((item) => item.slice('--card='.length))
    .filter((item) => item !== '')
}

async function main(): Promise<void> {
  const env = await readEnv()
  const from = resolve(arg('from', env['ASSET_ROOT']?.trim() || '.out/web'))
  const apply = process.argv.includes('--apply')
  const wanted = cardsWanted()

  const cardsRoot = join(from, 'cards')
  const available = (await readdir(cardsRoot, { withFileTypes: true }).catch(() => []))
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort()
  if (available.length === 0) {
    throw new Error(`这个根底下没有 cards/ 目录或它是空的：${cardsRoot}`)
  }

  const chosen = wanted.length > 0 ? wanted : available
  const unknown = chosen.filter((id) => !available.includes(id))
  if (unknown.length > 0) {
    throw new Error(`这个根底下没有这些卡：${unknown.join(' ')}（有：${available.join(' ')}）`)
  }

  console.log(`读      ${cardsRoot}`)
  console.log(`写      public/${DEMO_CARDS_DIR}/<卡号>/`)
  console.log(apply ? '模式    真导出\n' : '模式    只看计划（加 --apply 才动盘）\n')
  for (const id of chosen) {
    console.log(`  ${id}   ${kb(await sizeOf(join(cardsRoot, id)))}`)
  }
  if (!apply) {
    console.log('\n（没有动任何文件。确认这份清单之后加 --apply 再跑一次）')
    return
  }

  let total = 0
  const problems: string[] = []
  /** ★ 垫底层的根：`card-source.ts` 把 `public/demo/` 整个当一个只读资产根 */
  const demoBase = join(resolve('public'), DEMO_ROOT)
  for (const cardId of chosen) {
    const from_ = join(cardsRoot, cardId)
    const to = join(demoBase, 'cards', cardId)
    // 覆盖式导出：先清掉旧的那一份，免得留下上一版的孤儿图
    await rm(to, { recursive: true, force: true })
    await mkdir(to, { recursive: true })

    let copied = 0
    let bytes = 0
    for (const name of await readdir(from_)) {
      await copyFile(join(from_, name), join(to, name))
      bytes += (await stat(join(to, name))).size
      copied += 1
    }
    total += bytes

    // ── 预生成 `.webp` 兄弟文件（2026-10-18）────────────────────────────────
    // ★ 为什么卡也要一份小的：访客看到的那两张走**静态地址**（`public/` 下的文件，
    //   Next 直接发），而静态文件挂不了 `?w=`。没有这一份的话，墙上一张就是 327 KB 的原图
    //   （登录用户那张是 70 来 KB 的 webp）。★ 原图留在目录里：卡里的
    //   `reference.path` 指的就是它。
    const thumbs = await writeWebpSiblings(to, {
      width: CARD_FACE_WIDTH,
      extensions: ['.jpg', '.jpeg'],
    })

    // ── 自检 ────────────────────────────────────────────────────────────────
    const versions: CardJson[] = []
    for (const name of await readdir(to)) {
      if (!/^r\d+\..+\.json$/.test(name)) continue
      versions.push(JSON.parse(await readFile(join(to, name), 'utf8')) as CardJson)
    }
    const latest = await readFile(join(to, 'latest'), 'utf8').catch(() => '')
    const current = Number(latest.trim())
    /** 这个目录里现有的 `.webp` 兄弟文件（与运行期 `demoCardPathInPublic` 读的是同一份判据） */
    const siblings = await demoCardSiblingNames(cardId)
    if (!Number.isFinite(current) || current < 1) {
      problems.push(`${cardId}：latest 不是一个 revision（读到 "${latest.trim()}"）`)
    } else if (!versions.some((card) => card.revision === current)) {
      problems.push(`${cardId}：latest 指着第 ${current} 版，而那一版不在盘上`)
    }
    for (const card of versions) {
      // ★ 判据是"**逻辑路径在 public/demo 底下逐字成立**"——那正是 `card-source.ts`
      //   整个布局依赖的那条性质。所以这里拼的是 `demo/<逻辑路径>`，不是卡目录里的文件名
      const ref = join(demoBase, card.reference.path)
      const here = await stat(ref).catch(() => null)
      if (!here) {
        problems.push(`${cardId} r${card.revision}：参考图不在 ${card.reference.path}`)
        continue
      }
      // 参考图是**内容寻址**的：文件名里那段指纹就是"这张图是哪一版卡的"的凭据。
      // 复制过程动了文件名（或改了图），这一个理由是答不上来的
      if (!nameOf(ref).includes(`.${card.reference.digest}.`)) {
        problems.push(
          `${cardId} r${card.revision}：参考图名里的指纹与卡里记的 ${card.reference.digest} 对不上`,
        )
      }
      if (here.size !== card.reference.bytes) {
        problems.push(
          `${cardId} r${card.revision}：参考图 ${here.size} 字节，卡里记的是 ${card.reference.bytes}`,
        )
      }
      // ★ 访客那条路走的是**兄弟文件**（静态地址挂不了 `?w=`）：少了它，
      //   静态地址会回落到原图，墙上一张就是 327 KB。
      //   判据与运行期同源——`demoCardSiblingNames` 就是 `demoCardPathInPublic`
      //   拿去判断"有没有小图"的那一份集合
      const sibling = nameOf(ref).replace(/\.[^.]+$/, '.webp')
      if (!siblings.has(sibling)) {
        problems.push(
          `${cardId} r${card.revision}：参考图没有 .webp 兄弟文件（缺 ${sibling}）——访客那一屏会拉原图`,
        )
      }
    }

    console.log(
      `导出 ${cardId}\n  文件 ${copied} 个 · ${kb(bytes)} · ${versions.length} 个版本` +
        ` · latest 指第 ${current} 版\n` +
        `  缩略图 ${thumbs.made} 张（${CARD_FACE_WIDTH}px webp q${THUMB_QUALITY}）：` +
        `原图 ${kb(thumbs.sourceBytes)} → 小的 ${kb(thumbs.webpBytes)}`,
    )
  }

  console.log(`\n合计 ${chosen.length} 张 · ${kb(total)}`)
  if (problems.length > 0) {
    console.log(`\n✗ 有 ${problems.length} 条对不上——这一份导出**不能用**：`)
    for (const one of problems) console.log(`  ${one}`)
    process.exitCode = 1
    return
  }
  console.log('每一版的参考图都在盘上、指纹对得上、小图也生成了 ✓')
}

main().catch((err: unknown) => {
  process.stderr.write(`失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
