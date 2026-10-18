/**
 * booklist.test.ts —— 灵感书单那 12 本样书的**结构性**约束
 *
 * ★ 为什么为一份"内容表"写测试：它坏起来是**静默**的，界面上没有任何异常。
 *   与 `creation/example-wishes.test.ts` 那套理由同源，只是这里多了两条更值钱的：
 *
 *   1. **`key` 与 `THEME_KEYS` 脱钩** —— 少一本、多一本、写错一个字母，
 *      书单墙上就有一格点进去是空的（或者首页那个主题在书单里缺席）。
 *   2. **正文长度** —— 它是**叠在左页下角的字**，也是 `p{N}.m4a` 的逐字稿。
 *      太短，一段朗读只有三四秒，翻页节奏会碎；太长，一屏放不下、要缩字号，
 *      而"宁慢不快"的时长预算（`demo-narration-script.md` §二）也就守不住了。
 *
 *      ★ 2026-10-15 用户听完第一版说"音频有点短"，于是这一档整体加长了一倍：
 *      **每跨页 2–3 行、每行 ≤ 22 字、合计 42–60 字**，对应约 **13–19 秒**。
 *      上限 60 不是审美，是**版面容量**：一句话 20 字（视口 1920 时字号封顶 19px，
 *      文字块宽 386px）刚好一行，三行是左页下角那块纸色渐变能不盖住画的上限。
 *      再长就要加高那块渐变、压掉画面——那是另一个取舍（加跨页），不是加字。
 *      60 字 ≈ 19 秒，八页一本约 2 分 10 秒。
 *
 * 这里断言的全部是"能说清对错"的事实，没有一条是"我觉得好看"。
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { THEME_KEYS, THEMES } from '@/lib/themes.ts'

import {
  AUDIO_EXTS,
  BOOKLIST,
  PAPER_PAGES_PER_BOOK,
  SPREADS_PER_BOOK,
  artPath,
  audioPath,
  bookOf,
  coverPath,
} from './booklist.ts'
import { BOOKLIST_TINTS } from './booklistTints.ts'

/** 一条正文合计多少字（含标点：朗读要连标点一起停） */
const charCount = (lines: readonly string[]) => lines.join('').length

describe('12 本与 12 个主题', () => {
  it('一本一个主题，且与 THEME_KEYS 同序（顺序决定书单墙第一行的排法）', () => {
    expect(BOOKLIST.map((book) => book.key)).toEqual([...THEME_KEYS])
  })

  it('每本都查得回来（墙上每一格点进去都有书）', () => {
    for (const theme of THEMES) {
      const book = bookOf(theme.key)
      expect(book, `${theme.key} 没有样书，那一格点进去是空的`).toBeDefined()
      expect(book?.key).toBe(theme.key)
    }
  })

  it('查不到的 key 返回 undefined，而不是硬凑一本（阅读器要靠它给空态）', () => {
    expect(bookOf('not-a-theme')).toBeUndefined()
    expect(bookOf('')).toBeUndefined()
  })
})

describe('一本书的形状', () => {
  it(`每本正好 ${SPREADS_PER_BOOK} 个跨页（= ${PAPER_PAGES_PER_BOOK} 个书页）`, () => {
    expect(PAPER_PAGES_PER_BOOK).toBe(16)
    for (const book of BOOKLIST) {
      expect(book.spreads, `《${book.title}》的跨页数不对`).toHaveLength(SPREADS_PER_BOOK)
    }
  })

  it('书名、主角锚点、墙上那句话都非空且全局唯一', () => {
    const titles = BOOKLIST.map((book) => book.title)
    const heroes = BOOKLIST.map((book) => book.hero)
    const blurbs = BOOKLIST.map((book) => book.blurb)
    for (const list of [titles, heroes, blurbs]) {
      for (const value of list) expect(value.trim().length).toBeGreaterThan(0)
      expect(new Set(list).size, '有重复项——两本书会被读成同一本').toBe(list.length)
    }
  })

  it('刻度短名在一本书里不重复（重复的刻度点起来像坏了）', () => {
    for (const book of BOOKLIST) {
      const captions = book.spreads.map((spread) => spread.caption)
      expect(new Set(captions).size, `《${book.title}》有重名的跨页`).toBe(captions.length)
      for (const caption of captions) expect(caption.length).toBeLessThanOrEqual(6)
    }
  })
})

describe('正文：既是屏上的字，也是朗读稿', () => {
  it('每个跨页 2–3 行、每行 ≤ 22 字、合计 42–60 字（对应约 13–19 秒）', () => {
    for (const book of BOOKLIST) {
      for (const spread of book.spreads) {
        const where = `《${book.title}》·${spread.caption}`
        expect(spread.text.length, `${where} 的行数不对`).toBeGreaterThanOrEqual(2)
        expect(spread.text.length, `${where} 的行数太多，下角放不下`).toBeLessThanOrEqual(3)
        const n = charCount(spread.text)
        expect(n, `${where} 只有 ${n} 字，一段朗读太短了`).toBeGreaterThanOrEqual(42)
        expect(n, `${where} 有 ${n} 字，超了版面容量（三行纸色渐变的极限）`).toBeLessThanOrEqual(60)
        for (const line of spread.text) {
          expect(line.trim().length).toBeGreaterThan(0)
          // 一行 22 字是"在 19px 下正好一行"的上限，超了就会折行、把三行变成四五行
          expect(line.length, `${where} 里有一行 ${line.length} 字，会折行`).toBeLessThanOrEqual(22)
        }
      }
    }
  })

  it('正文里不出现阿拉伯数字与拉丁字母', () => {
    // ★ 两条理由：一是这本书里没有一处出现它们（"三，二，一"写的是汉字），
    //   二是将来接 TTS 时，混排的阿拉伯数字是中文朗读最常见的错读来源。
    const banned = /[0-9A-Za-z]/
    for (const book of BOOKLIST) {
      expect(banned.test(book.title), `《${book.title}》的书名里有数字或字母`).toBe(false)
      for (const spread of book.spreads) {
        const joined = spread.text.join('')
        expect(banned.test(joined), `《${book.title}》·${spread.caption} 里有数字或字母`).toBe(
          false,
        )
      }
    }
  })
})

describe('资产路径', () => {
  it('图与音频同名同目录（"第 3 张图的音频"因此是一句物理事实）', () => {
    expect(artPath('dino', 3)).toBe('/booklist/dino/p3.webp')
    expect(audioPath('dino', 3)).toBe('/booklist/dino/p3.m4a')
    expect(coverPath('dino')).toBe('/booklist/dino/cover.webp')
    // 同一个 n，只差扩展名 —— 这一条是"对不上就得写映射表"那条教训的机器化
    expect(artPath('moon', 8).replace(/\.webp$/, '')).toBe(
      audioPath('moon', 8).replace(/\.m4a$/, ''),
    )
  })

  it('朗读认两种容器，`.m4a` 优先（第一本样书是 mp3 出的，2026-10-15）', () => {
    // ★ 次序是这件事的判据：两种都放，但"按规格出的那一种"排在前面
    expect(AUDIO_EXTS).toEqual(['m4a', 'mp3'])
    expect(audioPath('dino', 3, 'mp3')).toBe('/booklist/dino/p3.mp3')
    // 缺省仍是规格那一档（README §四 写的 AAC），放开容器不该把缺省也挪走
    expect(audioPath('dino', 3)).toBe('/booklist/dino/p3.m4a')
  })

  it('路径由 key 与页号决定，不含别的变量', () => {
    for (const theme of THEMES) {
      expect(coverPath(theme.key)).toBe(`/booklist/${theme.key}/cover.webp`)
      for (let n = 1; n <= SPREADS_PER_BOOK; n++) {
        expect(artPath(theme.key, n)).toBe(`/booklist/${theme.key}/p${n}.webp`)
      }
    }
  })
})

/**
 * 「桌面被当前这一页染一层色」那张色表（`booklistTints.ts`）
 *
 * ★ 为什么为一份**生成物**写测试 —— 它是这一整套里唯一会**静默过期**的东西。
 *   `scripts/sample-tints.py` 的 docstring 自己写着这条账：「手挑的话下一次换图
 *   就没人重挑，于是背景色与页面内容悄悄脱钩」。生成物把这个风险压缩成了
 *   「换了图记得重跑脚本」，但那仍然是一句要靠人记住的话。
 *   这条断言把"记得重跑"变成机器的事：**盘上每一张图都必须在表里有条目**。
 *   后果很具体 —— 加了第 13 本书、或者某本补画了一页而忘了重跑，
 *   `pnpm test` 当场红，而不是几个月后有人说"这本书的背景色怪怪的"。
 *
 * ★ 断言的是**盘上的事实**（`public/booklist/` 里真有什么），不是表自己的自洽性。
 *   表里多出来的条目（图删了、条目还在）由反向那一条管。
 *   `readdirSync` 在这里是允许的：vitest 的 environment 就是 'node'
 *   （见 `vitest.config.ts` 文件头那段），不是 jsdom。
 */
describe('桌面那张色表', () => {
  const root = join(process.cwd(), 'public', 'booklist')

  /** `public/booklist/` 下每个主题目录里真正躺着的图（相对站点 URL） */
  function imagesOnDisk(): string[] {
    const urls: string[] = []
    for (const key of readdirSync(root)) {
      const dir = join(root, key)
      if (!statSync(dir).isDirectory()) continue
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.webp')) urls.push(`/booklist/${key}/${file}`)
      }
    }
    return urls
  }

  it('盘上每一张图都有条目 —— 忘了重跑取样脚本就红在这里', () => {
    const missing = imagesOnDisk().filter((url) => !(url in BOOKLIST_TINTS))
    expect(missing).toEqual([])
  })

  it('表里没有指向不存在文件的条目（图删了、条目还在）', () => {
    const onDisk = new Set(imagesOnDisk())
    const stale = Object.keys(BOOKLIST_TINTS).filter((url) => !onDisk.has(url))
    expect(stale).toEqual([])
  })

  it('12 本 ×（封面 + 8 个跨页），一条不多一条不少', () => {
    expect(Object.keys(BOOKLIST_TINTS)).toHaveLength(THEME_KEYS.length * (SPREADS_PER_BOOK + 1))
  })

  it('每一条都是三朵十六进制色，且按彩度从高到低（CSS 的固定读法靠这一条）', () => {
    // ★ 断言的是**脚本真正保证的那一条**：彩度（最大通道 − 最小通道）递减。
    //   原来想断言"最后一朵最白"，一量才知道那是**取样结果不是保证** ——
    //   108 张里 30 张的第三朵是支中调色（castle 封面 `#a9805a`）。脚本抬头
    //   2026-10-18 已按实测改成现在这句说法，这条断言与它对齐。
    const chans = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const chroma = (hex: string): number => {
      const [r, g, b] = chans(hex) as [number, number, number]
      return Math.max(r, g, b) - Math.min(r, g, b)
    }
    for (const [url, tints] of Object.entries(BOOKLIST_TINTS)) {
      expect(tints, url).toHaveLength(3)
      for (const hex of tints) expect(hex, url).toMatch(/^#[0-9a-f]{6}$/)
      expect(chroma(tints[0]!), url).toBeGreaterThanOrEqual(chroma(tints[1]!))
      expect(chroma(tints[1]!), url).toBeGreaterThanOrEqual(chroma(tints[2]!))
    }
  })
})
