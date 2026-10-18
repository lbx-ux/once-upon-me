/**
 * reader-paper.ts —— 阅读器那层「底图」：用户挑哪一张
 *
 * 用户 2026-10-18 的要求：「背景点阵的样式有点晕，这也背景改为一张图片……
 * 多给几张设配的图片，用户之后可以在设置里面选择，选用哪张，图片不要太艳，
 * 不要抢绘本的视线」。三句话落在三处，这一份是**中间那一句**：
 * 图片有哪些、用户选的是哪一张、选的那个值怎么读怎么写。
 *
 * ★ 四条不显然的约定，每条都对应一次会真发生的事（前三条逐条照抄
 *   `reading-prefs.ts`——它已经跑通过一遍，这里不重新发明）：
 *
 * 1. **认不出来的一律退回默认**。存储里的东西不一定是自己写的：可能是上一版的格式、
 *    可能被人手改过、也可能某一天这一档被删了（用户换了一批图）。退回默认的方向是
 *    **不变**，而"猜一个"在这里没有安全的猜法——猜错了就是一屏他不认识的底。
 *    实现上**不写死那个默认值的字面量**：`plain` 与六张图都在 `READER_PAPERS` 里，
 *    读回来的键必须能在表里查到才算数。
 *
 * 2. **它只活在这台设备的这个浏览器里**（`localStorage`），与阅读记录、翻页偏好
 *    同一性质：换机器、清缓存就回到默认。★ 与 `xiaozhujue.reader.turn` 分开两个键：
 *    一个是"怎么翻"，一个是"底长什么样"，寿命与清空时机都不一样。
 *
 * 3. **纯的一层与碰盘的一层分开**：解析是纯函数、可测（`reader-paper.test.ts`）；
 *    只有 `load/save` 碰 `localStorage`，两边都接住异常。
 *    ★ 读不到就用默认、存不下就只在这会话里生效——**不许**因为一个偏好读不出来
 *    就让阅读这件事本身出问题。
 *
 * 4. **两张阅读器读同一份**。`/booklist/<key>` 与 `/reader/<bookId>` 是同一张桌子
 *    （那条交叉引用的注释写在两份 CSS 的文件头），所以底图这件事**只有一个偏好**，
 *    没有"书单那台用这个、独读那台用那个"。
 *
 * ★ 为什么默认是 `paper` 而不是 `plain`：点阵退役之后，"什么都不铺"会让大多数人
 *   一进门看到一块空场——而这一轮要的正是"这块底不那么简陋"。`paper` 是六张里
 *   最轻的一张（与页面底 `--bg` 差得最少的一档），选它等于**把既有观感改到最小**。
 */

/** 存储键。★ 与 `xiaozhujue.reading.v1`（阅读记录）、`xiaozhujue.reader.turn`（翻页）分开 */
export const READER_PAPER_KEY = 'xiaozhujue.reader.paper'

/** 一档底图。`url` 为 `null` 就是"不铺底图"，即纯 `--bg` */
export type ReaderPaperOption = {
  key: string
  /** 设置里那一行的名字 */
  label: string
  /** 阅读器里铺的那张（`null` = 这一档不铺图） */
  url: string | null
  /** 设置里那一行的缩略图（`null` 同义） */
  thumb: string | null
}

/**
 * 七档，**次第有序**：默认那张在最前，`plain` 在最后（它是一句"都不要"，
 * 不该夹在六张图中间）。六张图是 `scripts/make-reader-paper.mts` 出的，
 * 提示词与出图的经过写在那支脚本的文件头。
 *
 * ★ 加一档 = 三处一起动：这张表、`public/reader-papers/<key>.webp`（跑那支脚本）、
 *   以及 `reader-paper.test.ts` 里"盘上每一张都在表里、表里每一张都在盘上"那条断言。
 *   它红了就是在说"你加了一档但没出图"（或者反过来）。
 */
export const READER_PAPERS: readonly ReaderPaperOption[] = [
  {
    key: 'paper',
    label: '暖纸',
    url: '/reader-papers/paper.webp',
    thumb: '/reader-papers/paper.thumb.webp',
  },
  {
    key: 'wood',
    label: '木桌',
    url: '/reader-papers/wood.webp',
    thumb: '/reader-papers/wood.thumb.webp',
  },
  {
    key: 'linen',
    label: '亚麻',
    url: '/reader-papers/linen.webp',
    thumb: '/reader-papers/linen.thumb.webp',
  },
  {
    key: 'mist',
    label: '晨雾',
    url: '/reader-papers/mist.webp',
    thumb: '/reader-papers/mist.thumb.webp',
  },
  {
    key: 'clay',
    label: '陶土',
    url: '/reader-papers/clay.webp',
    thumb: '/reader-papers/clay.thumb.webp',
  },
  {
    key: 'chalk',
    label: '白垩',
    url: '/reader-papers/chalk.webp',
    thumb: '/reader-papers/chalk.thumb.webp',
  },
  { key: 'plain', label: '纯色', url: null, thumb: null },
]

export const DEFAULT_READER_PAPER = READER_PAPERS[0] as ReaderPaperOption

/** 键 → 那一档；给不出就是 `undefined`（`paperOf` 才会退到默认） */
export function findReaderPaper(key: string | null): ReaderPaperOption | undefined {
  if (!key) return undefined
  return READER_PAPERS.find((paper) => paper.key === key)
}

/** 键 → 那一档，**认不出来就退到默认**（见文件头第 1 条） */
export function paperOf(key: string | null): ReaderPaperOption {
  return findReaderPaper(key) ?? DEFAULT_READER_PAPER
}

/**
 * 存储里那串字 → 那一档。
 * ★ 判据是"在不在表里"，不是"是不是某个字面量"：表长什么样是这张表说了算。
 */
export function parseReaderPaper(raw: string | null): ReaderPaperOption {
  return paperOf(raw)
}

export function loadReaderPaper(): ReaderPaperOption {
  if (typeof window === 'undefined') return DEFAULT_READER_PAPER
  try {
    return parseReaderPaper(window.localStorage.getItem(READER_PAPER_KEY))
  } catch {
    // 隐私模式 / 禁用了存储：读不到就用默认，阅读本身照常
    return DEFAULT_READER_PAPER
  }
}

export function saveReaderPaper(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(READER_PAPER_KEY, key)
  } catch {
    // 配额满或隐私模式：这一次会话里照样生效，只是下次打开要重选
  }
}
