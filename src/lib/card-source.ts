/**
 * card-source.ts —— 一张角色卡**从哪读**：运行期写出来的那一片，或随仓库发布的示例卡
 *
 * 与 `children-source.ts`、`book-source.ts` 同一个形状、同一条理由
 * （"两个来源、一个函数"）：
 *
 * ```
 *   1. 运行期：ASSET_ROOT/u/<userId>/cards/<卡号>/   （家长自己做的）
 *   2. 示例：  public/demo/cards/<卡号>/              （随仓库发布，断网也在）
 * ```
 *
 * ★★ 与另外那两个**不一样的地方只有一个：这里垫在底下的是 store，不是路径。**
 *   示例档案的读取是"读一个 JSON"，示例书是"读一份清单 + 一串图 + 算 URL"，
 *   两者都在自己的函数里就能收口。而一张卡要被两拨人读：
 *   · 列卡/详情（`cards-list.ts`、`children-list.ts`）——读 `rN.<指纹>.json` 与 `latest`；
 *   · **出图那一条**（`engine/index.ts`）——它拿 `card.reference.path` 去
 *     `providers.store.read(...)`，因为卡本体那 327 KB 的参考图要当锁脸的输入。
 *   第二拨走的是**store 本身**，绕不过去。所以这一层给 store 也加一个实现：
 *   **示例卡垫在底下**。于是引擎、卡存储、导出脚本、缩略图，一个字节都不用改。
 *
 * ★★ 为什么示例卡**现在**才发（2026-10-17）：
 *   `public/demo/children/` 里那两个示例孩子的档案早就在了，而他们的卡没有，
 *   所以界面上一直是「形象还没印出来」——`CharacterWall` 第 22 行那句
 *   "不拿一张示例图去顶"说的正是这件事：**那时确实没有图，所以照实说没有**。
 *   现在两张卡（各 327 / 357 KB 的 jpg）随仓库发出来，那句话就该换成
 *   "示例孩子的图现在有了"。它不是被顶上去的，是真的。
 *
 * ★ 三条纪律：
 *
 * 1. **只对 `cards/` 生效。** 垫底层的根是 `public/demo/`，`books/` 与 `children/`
 *    也躺在它底下——但这两个来源各有各的收口函数（`resolveBook` / `listChildren`），
 *    这里有第二个入口就等于"同一份字节有两条路"，而两条路的症状是
 *    "本地能翻、演示那台说图不存在"（`book-source.ts` 文件头那句）。
 * 2. **写与删永远落在 base。** 示例卡在你那一片里根本不存在，所以它改不动、
 *    也删不掉——这与 `isDemoChildId` 那条 403 是同一条道理（仓库里的东西不改）。
 *    ★ 代价说清楚：**"删除看起来成功、其实没删"** 是这里唯一危险的形状。
 *    现在没有任何一条路由能单独删一张卡（删除只有"按孩子删"，而示例孩子那条路
 *    已经被 `children/[childId]` 的 `refuse()` 挡住了）。要新开删除入口，
 *    必须先在**动手之前**认出示例卡。
 * 3. **运行期优先。** 同一条路径两边都有时读 base 的那一份：家长"换一版"之后
 *    自己那一片里有 `r2`，而示例那份还停在 `r1`——先读示例的话，
 *    他刚画的那一版会看不见。
 *
 * ★ 判据是**路径前缀**，不是"这张卡在不在示例目录里"：两张磁盘都按同一套逻辑路径
 *   摆（`cards/<卡号>/rN.<指纹>.json`、`ref.<指纹>.jpg`、`latest`），
 *   所以 `public/demo` 就是一个"只读的资产根"。导出脚本因此是**整目录复制**，
 *   一个路径都不用翻译——`assetPathInDemo` 那种摘前缀在这一层不存在。
 */

import { join } from 'node:path'

import { createFsStore } from './engine/index.ts'
import type { AssetStore, PutEntry } from './engine/providers/types.ts'

/**
 * 仓库里那份示例资产的根。★ 与 `book-source.ts` 的 `demo/books`、
 * `children-source.ts` 的 `demo/children` 摆在同一层（都是 `public/demo/` 底下）
 */
export const DEMO_ROOT = 'demo'

/** 示例卡在 `public/` 下的位置。★ 导出脚本与这一层**共用**这串字面量 */
export const DEMO_CARDS_DIR = `${DEMO_ROOT}/cards`

/** 垫底层只认这一族路径。★ 结尾那个斜杠是承重的：`cardsfoo/` 不算 */
export const CARDS_MOUNT = 'cards/'

/** 一张示例卡在磁盘上的目录（导出脚本写它，测试读它） */
export function demoCardDir(cardId: string): string {
  return join(process.cwd(), 'public', DEMO_ROOT, 'cards', cardId)
}

/**
 * 垫底层本身：`public/demo/` 这一个**只读的资产根**。
 *
 * ★ 根取在 `demo/` 而不是 `demo/cards/`：逻辑路径 `cards/<卡号>/x` 与它底下的
 *   物理路径**逐字相同**，于是"演示布局"与"运行期布局"是同一套，
 *   导出脚本整目录复制即可（见文件头最后一段）。
 */
async function demoShelf(): Promise<AssetStore> {
  return createFsStore(join(process.cwd(), 'public', DEMO_ROOT))
}

/** 这一条路径属不属于"卡"那一族 */
function isCardPath(path: string): boolean {
  return path === CARDS_MOUNT.replace(/\/$/, '') || path.startsWith(CARDS_MOUNT)
}

/**
 * 把 `base` 包成"读卡时先自己那一片、再示例卡"的 store。
 *
 * ★ `demo` 是可注入的（缺省是真的 `public/demo`），所以这一层的判据能被
 *   `createMemoryStore` 钉住——与 `asset-scope.ts` 的 `scopedStore` 同一条理由：
 *   那些性质（谁优先、写落在哪、`books/` 会不会穿过去）与磁盘无关。
 */
export async function withDemoCards(base: AssetStore, demo?: AssetStore): Promise<AssetStore> {
  const fallback = demo ?? (await demoShelf())

  return {
    id: `${base.id}+demo-cards`,

    // ── 写：**只有 base**。示例那一份是仓库内容，运行期不碰 ────────────────
    put(entry: PutEntry) {
      return base.put(entry)
    },
    putJson(entry: { path: string; value: unknown }) {
      return base.putJson(entry)
    },
    deletePrefix(prefix: string) {
      return base.deletePrefix(prefix)
    },

    // ── 读：自己那一片优先，落空再问示例（且只问 cards/ 那一族）─────────────
    async read(path: string) {
      const mine = await base.read(path)
      if (mine) return mine
      return isCardPath(path) ? fallback.read(path) : null
    },

    async readJson<T>(path: string): Promise<T | null> {
      const mine = await base.readJson<T>(path)
      if (mine) return mine
      return isCardPath(path) ? fallback.readJson<T>(path) : null
    },

    async exists(path: string) {
      if (await base.exists(path)) return true
      return isCardPath(path) ? fallback.exists(path) : false
    },

    /**
     * ★ 并集，不是"谁优先"。
     *
     * 这里唯一要紧的调用方是 `cardStore.summaries()`——它就是"有哪些卡"这件事，
     * 而示例卡必须出现在**每一个**人的舞台上（`/character`、`/home` 的选择器）。
     * 只回 base 的话，示例卡在界面上根本不存在；只回 fallback 的话，
     * 家长自己做的卡会全都不见。
     */
    async list(prefix: string) {
      const mine = await base.list(prefix)
      if (!isCardPath(prefix)) return mine
      const theirs = await fallback.list(prefix)
      return [...new Set([...mine, ...theirs])].sort()
    },
  }
}
