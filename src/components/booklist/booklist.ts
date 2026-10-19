/**
 * booklist.ts —— 「灵感书单」那 12 本样书的**内容根**
 *
 * 与 `book/demoBook.ts` 同一个先例（那个内容模块随首页第二屏一起下架了，先例照旧）：
 * 内容模块挨着组件放，只放内容与类型。
 * 几何整块借 `book/flip.ts`（纯函数，一行不改），渲染在 `BooklistReader.tsx`。
 *
 * ---------------------------------------------------------------------------
 * 这 12 本是什么、不是什么（先说清，免得日后有人把它当内容库）
 *
 *   · **是按主题预做的样书**，一本一个主题，与首页环上那 12 张封面一一对应。
 *     用途是让人（尤其是评审）在"生成一整本"那条流水线还在做的当下，
 *     就能翻开一本成品，看形状、看节奏、看配音该怎么配。
 *   · **不是给你家孩子生成的书**——那是「创作」那一路。所以这 12 本
 *     不进书架、不写阅读记录、不接创作流，只读。
 *
 * ---------------------------------------------------------------------------
 * 一跨页 = 一张图（这是用户 2026-10-15 定的，也是"和首页那本一样"的意思）
 *
 *   翻开一屏 = **1 张 3:2 的连续画面**（横跨左右两个书页）+ 正文叠在左页下角，
 *   与首页第二屏那本《小宇的云》同一个形状。8 个跨页 = **16 个书页**。
 *
 *   ★ 半页**不切文件**：同一张图挂两次，靠 `background-size: 200% 100%` +
 *     `background-position` 各取一半（`flip.ts` 顶部那段叶模型就是这么定的）。
 *     所以"一页两张图"这种形状在这里不会出现——它是**一张图跨两个书页**。
 *
 * ---------------------------------------------------------------------------
 * 正文就是配音稿，逐字一致
 *
 *   `spreads[].text` 有两个消费者：叠在左页下角的**真 HTML 文字**，和
 *   `p{N}.m4a` 那段朗读的**逐字稿**。`docs/demo-narration-script.md` §一 第 1 条
 *   那条纪律在这里照旧：念的必须就是印的，一个字都不许改。
 *   所以这一份文本**同时**是内容与录音稿，改一个字就是两处一起改。
 *
 *   ★ **长度是版面算出来的，不是审美**：每跨页 2–3 行、每行 ≤ 22 字、合计 42–60 字
 *     （约 13–19 秒，一本八页约 2 分 10 秒）。上限来自左页下角那块纸色渐变
 *     ——一句话 20 字在 18px 下正好一行，三行是它能不盖住画的上限
 *     （推导写在 `booklist-reader.css` 的 `.blr__text` 上，测试摁着这三个数）。
 *     2026-10-15 用户听完第一版说"音频有点短"，这一档是整体加长一倍之后的样子。
 */

import type { ThemeKey } from '@/lib/themes.ts'

import balloon from './books/balloon.ts'
import bird from './books/bird.ts'
import castle from './books/castle.ts'
import cloud from './books/cloud.ts'
import dino from './books/dino.ts'
import flower from './books/flower.ts'
import moon from './books/moon.ts'
import paint from './books/paint.ts'
import rocket from './books/rocket.ts'
import star from './books/star.ts'
import turtle from './books/turtle.ts'
import whale from './books/whale.ts'

/** 一个跨页 = 一张 3:2 的图 + 叠在**左页下角**的那段正文 */
export type BooklistSpread = {
  /** 刻度与目录上的短名，2–5 字 */
  caption: string
  /**
   * 这一跨页的正文（**2–3 行，每行 ≤ 22 字，合计 42–60 字**，约 13–19 秒）。
   * ★ 它同时是 `p{N}.m4a` 的朗读稿——逐字，不许有第二份。
   * 长度的来源是版面容量，不是审美，见文件头。
   */
  text: readonly string[]
}

export type BooklistBook = {
  /** 与 `THEMES` 一一对应，同时也是资产目录名：`public/booklist/{key}/` */
  key: ThemeKey
  /** 书名，不带书名号（界面自己加） */
  title: string
  /** 主角锚点一句话。出图文档与将来的引擎共用这一句，不许各写一份 */
  hero: string
  /** 书单那面墙上的一句话 */
  blurb: string
  /** 正好 8 个跨页 */
  spreads: readonly BooklistSpread[]
}

/** 每本 8 个跨页。★ 它与 `flip.ts` 的叶表咬死：N 个跨页需要 N+1 叶 */
export const SPREADS_PER_BOOK = 8
/** 每本 16 个书页 —— 界面上的页码口径（8 跨页 × 2 页），也是用户说的"至少 16 页" */
export const PAPER_PAGES_PER_BOOK = SPREADS_PER_BOOK * 2

/**
 * 12 本，**按 `THEME_KEYS` 的顺序**（与首页环上那 12 张封面同序）。
 * 顺序有意义：书单墙第一行的排法与首屏一致，两处对得上。
 */
export const BOOKLIST: readonly BooklistBook[] = [
  dino,
  paint,
  rocket,
  bird,
  star,
  moon,
  whale,
  castle,
  cloud,
  flower,
  turtle,
  balloon,
]

export function bookOf(key: string): BooklistBook | undefined {
  return BOOKLIST.find((book) => book.key === key)
}

/* ---------------------------------------------------------------------------
 * 资产路径 —— 统一从这里取，避免 `/booklist/` 这个约定散落在各处
 *
 * ★ 图与音频**同名同目录**（`p3.webp` 与 `p3.m4a`）："第 3 张图的音频是哪个"
 *   因此是一句物理事实，不是一条要靠人记住的约定。对不上就得写映射表，
 *   而映射表一定会过期（`demo-narration-script.md` §五 那条）。
 * ------------------------------------------------------------------------- */

/** 3:4 竖版封面：`public/booklist/{key}/cover.webp` */
export function coverPath(key: ThemeKey): string {
  return `/booklist/${key}/cover.webp`
}

/** 第 n 个跨页的 3:2 图（n 从 1 起） */
export function artPath(key: ThemeKey, pageNo: number): string {
  return `/booklist/${key}/p${pageNo}.webp`
}

/**
 * 朗读认这两个扩展名，**按这个顺序问盘**（`lib/booklist-assets.ts`）。
 *
 * ★ 2026-10-15 从"只认 `.m4a`"放开。理由不是宽容，是这条约定**本来在说什么**：
 *   它管的是"第 3 张图的音频是哪个"——**同一个目录、同一个序号**，与容器无关。
 *   第一本样书（恐龙）的 8 段配音是用户用 `.mp3` 出的，而只认 `.m4a` 的读盘
 *   会让这本看起来"还没有录朗读"：8 段就躺在那个目录里，界面却一直道歉。
 *   把约定读成教条、还要用户回去转码，证的是这条约定的反面。
 *
 * `.m4a` 仍排第一，因为规格那一档（`docs/booklist/README.md` §四）写的还是 AAC：
 *   两种都能放，但**新录的那一本请按规格出**，别让"反正都认"变成第三种格式的开端。
 */
export const AUDIO_EXTS = ['m4a', 'mp3'] as const

export type AudioExt = (typeof AUDIO_EXTS)[number]

/** 第 n 个跨页的朗读（与图同名，只差扩展名）。缺省是规格那一档 AAC（`.m4a`） */
export function audioPath(key: ThemeKey, pageNo: number, ext: AudioExt = 'm4a'): string {
  return `/booklist/${key}/p${pageNo}.${ext}`
}
