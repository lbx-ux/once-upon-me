/**
 * corpus.test.ts —— 切块、指纹、以及提交的那份索引与语料自洽
 *
 * 三组用例，各管一件不同的事：
 *
 * 1. 切块逻辑（合成本，纯函数）：形状、元数据、`text` 与 `source` 分家。
 *    用合成样本而不是真那 12 本，是因为这里要问的是"给定这个形状，切出来对不对"，
 *    而真语料随时会被改写（改写时红的是下面第三组，不是这一组）。
 * 2. 指纹：同输入同指纹、改一个字要变、重跑不能变、换顺序不能变。
 * 3. 护栏：读盘上那份 `index.seed.json`，问"它跟它自己说的内容一致吗"——
 *    这一条是纯函数测不到的那件事：改了语料却忘了重跑 `build-rag-index`，
 *    纯函数永远是绿的，而线上用的是那份旧的索引。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  ANY,
  ageBandOfSample,
  buildRagIndex,
  chunksFromBooklist,
  chunksFromStoryBook,
  corpusVersionOf,
  MAX_CHUNK_CHARS,
  parseRagIndex,
  type RagChunk,
  type StoryBookSource,
} from './corpus.ts'
import { planJsonSchema } from '../schemas/story.ts'

const SAMPLE_BOOKS = [
  {
    key: 'cloud',
    title: '小飞看见的那朵云',
    hero: '小飞，约 5 岁的东亚孩子：乌黑短发、额前碎刘海；圆脸、大眼睛。',
    spreads: [
      {
        caption: '躺在垫子上',
        text: ['正午，小飞躺在野餐垫上，手枕在脑后。', '远处草坡上，有一排树。'],
      },
      { caption: '云在变', text: ['天上有一朵云，正在慢慢地变着形状。'] },
      { caption: '', text: ['', '   '] },
    ],
  },
  {
    key: 'moon',
    title: '端一盘月亮回家',
    hero: '囡囡，约 4 岁的东亚小女孩：齐耳短发。',
    spreads: [{ caption: '水盆里', text: ['月亮掉进了水盆里。'] }],
  },
]

describe('① 种子：12 本样书 → chunks', () => {
  const chunks = chunksFromBooklist(SAMPLE_BOOKS)

  it('一个跨页一条；**空的跨页不产 chunk**（它连一个字都没有）', () => {
    expect(chunks).toHaveLength(3)
  })

  it('id 稳定且人读得懂：`library/<主题>#s<序号>`', () => {
    expect(chunks.map((chunk) => chunk.id)).toEqual([
      'library/cloud#s1',
      'library/cloud#s2',
      'library/moon#s1',
    ])
  })

  it('元数据：owner 是 library、主题取书键、形态对两种都开放', () => {
    for (const chunk of chunks) {
      expect(chunk.owner).toBe('library')
      expect(chunk.kind).toBe('spread')
      // form 是 ANY 而不是 solo：样书是线性的，但它在这里的作用是"句子长什么样"，
      //   标成 solo 会让共读版那一半请求一条都取不到（见 corpus.ts 那段 ★）
      expect(chunk.form).toBe(ANY)
    }
    expect(chunks.map((chunk) => chunk.theme)).toEqual(['cloud', 'cloud', 'moon'])
  })

  it('`text` 里**不许出现书名与页码**，出处只在 `source` 里', () => {
    for (const chunk of chunks) {
      expect(chunk.text).not.toContain('《')
      expect(chunk.text).not.toContain('跨页')
      expect(chunk.source).toContain('《')
    }
    expect(chunks[0]?.text).toBe(
      '躺在垫子上\n正午，小飞躺在野餐垫上，手枕在脑后。\n远处草坡上，有一排树。',
    )
    expect(chunks[0]?.source).toBe('样书《小飞看见的那朵云》第 1 跨页 · 躺在垫子上')
  })

  it('主角锚点**不进 text**（它会教模型描写长相，而长相是角色卡的职责）', () => {
    for (const chunk of chunks) expect(chunk.text).not.toContain('东亚孩子')
  })

  it('年龄档从 hero 那句「约 N 岁」读出来，读不到就是通配（不编一个数）', () => {
    expect(ageBandOfSample('约 5 岁的东亚孩子')).toBe('4-6')
    expect(ageBandOfSample('约 4 岁')).toBe('4-6')
    expect(ageBandOfSample('约 3 岁')).toBe('4-')
    expect(ageBandOfSample('约 7 岁')).toBe('6-8')
    expect(ageBandOfSample('约 9 岁')).toBe('8+')
    expect(ageBandOfSample('一个没说岁数的孩子')).toBe(ANY)
    expect(chunks.map((chunk) => chunk.ageBand)).toEqual(['4-6', '4-6', '4-6'])
  })
})

describe('② 创作史：一个家庭自己的书 → chunks', () => {
  const book: StoryBookSource = {
    bookId: 'bk_ab12',
    owner: 'u/12',
    title: '小雨的火箭',
    theme: 'rocket',
    form: 'solo',
    ageBand: '4-6',
    pages: [
      {
        pageNo: 1,
        scene: '纸箱火箭摆在客厅中间',
        body: ['她把三个座位都画上了。', '其中一个留给妈妈。'],
      },
      { pageNo: 2, scene: '', body: [] },
    ],
  }
  const chunks = chunksFromStoryBook(book)

  it('一页一条，id 带 owner 前缀（隐私边界就靠这个前缀）', () => {
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.id).toBe('u/12/books/bk_ab12#p1')
    expect(chunks[0]?.id.startsWith('u/12/')).toBe(true)
  })

  it('text 是场景 + 正文；source 是书名 + 页码', () => {
    expect(chunks[0]?.text).toBe('纸箱火箭摆在客厅中间\n她把三个座位都画上了。\n其中一个留给妈妈。')
    expect(chunks[0]?.source).toBe('《小雨的火箭》第 1 页')
  })

  it('缺哪个元数据就填通配，**不许编一个像样的默认值**', () => {
    const bare = chunksFromStoryBook({
      bookId: 'bk_x',
      owner: 'u/3',
      title: '没有元数据的一本',
      pages: [{ pageNo: 1, scene: '一片草地', body: ['风来了。'] }],
    })
    expect(bare[0]?.ageBand).toBe(ANY)
    expect(bare[0]?.theme).toBe(ANY)
    expect(bare[0]?.form).toBe(ANY)
  })

  /**
   * 上界（2026-10-20）。`story.json` 只过信封校验（`isStoryDoc` 只认
   *   "title 是字符串、nodes 是对象数组"），所以家长存回来的 `scene` / `body`
   *   长度没有任何东西在管，而 chunk 的正文会原样进故事规划的提示词。
   *   一个 100 kB 的 scene 足以把整条用户消息淹没，症状是"生成失败"，
   *   看不出跟检索有关。
   */
  it('★ 病态长的正文被削到上界，并留下 `…`（不静默）', () => {
    const huge = chunksFromStoryBook({
      bookId: 'bk_huge',
      owner: 'u/9',
      title: '一页塞了一本书',
      pages: [{ pageNo: 1, scene: '场'.repeat(5000), body: ['正文'.repeat(3000)] }],
    })
    const text = huge[0]?.text ?? ''
    expect([...text].length).toBe(MAX_CHUNK_CHARS + 1) // 削过之后 + 一个省略号
    expect(text.endsWith('…')).toBe(true)
  })

  it('正常长度的正文一个字都不动（这道闸挡的是病态输入，不是内容）', () => {
    expect(chunks[0]?.text).not.toContain('…')
    expect(chunks[0]?.text).toBe('纸箱火箭摆在客厅中间\n她把三个座位都画上了。\n其中一个留给妈妈。')
  })

  /**
   * ★ 这个数与 codec 同源：它必须 ≥ codec 允许的一页上限
   *   （`scene` ≤ 200 + `body` ≤ 4 × 120 = 680），否则它会开始削合法的页。
   *   放宽 codec 而不抬这个数，这一条会红。
   */
  it('★ 上界不小于 codec 允许的一页（放宽 codec 忘了抬这个数就会红）', () => {
    const node = planJsonSchema() as {
      properties: { nodes: { items: { properties: Record<string, { maxLength?: number }> } } }
    }
    const fields = node.properties.nodes.items.properties
    const scene = fields['scene']?.maxLength ?? 0
    const bodyLines = 4
    const bodyItem = (
      node.properties.nodes.items.properties['body'] as unknown as {
        items: { maxLength?: number }
      }
    ).items.maxLength
    expect(MAX_CHUNK_CHARS).toBeGreaterThanOrEqual(scene + bodyLines * (bodyItem ?? 0))
  })
})

describe('内容指纹', () => {
  const base = chunksFromBooklist(SAMPLE_BOOKS)

  it('同输入同指纹', () => {
    expect(corpusVersionOf(base)).toBe(corpusVersionOf(chunksFromBooklist(SAMPLE_BOOKS)))
  })

  it('改一个字就换指纹', () => {
    const edited = chunksFromBooklist([
      {
        ...SAMPLE_BOOKS[0]!,
        spreads: [{ caption: '躺在垫子上', text: ['正午，小飞躺在垫子上。'] }],
      },
    ])
    expect(corpusVersionOf(edited)).not.toBe(corpusVersionOf(base))
  })

  it('**重跑不改指纹**：`builtAt` 不进指纹', () => {
    const first = buildRagIndex(base, 1_700_000_000_000)
    const second = buildRagIndex(base, 1_800_000_000_000)
    expect(first.corpusVersion).toBe(second.corpusVersion)
  })

  it('**换顺序不改指纹**（顺序不影响能取到什么，只影响并列时的先后）', () => {
    expect(corpusVersionOf([...base].reverse())).toBe(corpusVersionOf(base))
  })
})

describe('parseRagIndex：坏了就报错，不静默降级', () => {
  const ok: RagChunk = {
    id: 'library/cloud#s1',
    kind: 'spread',
    owner: 'library',
    ageBand: '4-6',
    theme: 'cloud',
    form: ANY,
    text: '天上有一朵云。',
    source: '样书《小飞看见的那朵云》第 1 跨页 · 云在变',
  }
  const wrap = (chunk: unknown) => ({ corpusVersion: 'abc123', builtAt: 1, chunks: [chunk] })

  it('合格的能读回来', () => {
    const index = parseRagIndex(wrap(ok))
    expect(index.chunks).toHaveLength(1)
    expect(index.chunks[0]?.text).toBe('天上有一朵云。')
  })

  it('逐条拒绝：字段缺失、kind 不认识、owner 不成样子、ageBand 不认识', () => {
    expect(() => parseRagIndex(null)).toThrow(/根不是一个对象/)
    expect(() => parseRagIndex({ builtAt: 1, chunks: [] })).toThrow(/缺少 corpusVersion/)
    expect(() => parseRagIndex({ corpusVersion: 'a', builtAt: 1, chunks: {} })).toThrow(
      /chunks 不是数组/,
    )
    expect(() => parseRagIndex(wrap({ ...ok, kind: 'prompt' }))).toThrow(
      /第 1 条 的 kind「prompt」不认识/,
    )
    expect(() => parseRagIndex(wrap({ ...ok, owner: 'someone-else' }))).toThrow(
      /owner「someone-else」/,
    )
    expect(() => parseRagIndex(wrap({ ...ok, ageBand: '5-7' }))).toThrow(/ageBand「5-7」不认识/)
    expect(() => parseRagIndex(wrap({ ...ok, text: '' }))).toThrow(/text 不是非空字符串/)
  })

  it('报错里说得清是第几条（一份 96 条的索引里只报"不合格"等于没说）', () => {
    expect(() =>
      parseRagIndex({ corpusVersion: 'a', builtAt: 1, chunks: [ok, { ...ok, id: '' }] }),
    ).toThrow(/第 2 条/)
  })
})

/**
 * 护栏：磁盘上那份索引。
 *
 * 这一组问的是一件纯函数测不到的事——两份东西（语料与索引文件）是不是同一份。
 *   改了 12 本样书里一个字却忘了重跑脚本，上面所有用例照样全绿，
 *   而线上用的是旧索引。这里会红。
 */
describe('★ 提交的 index.seed.json 与语料自洽', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('./index.seed.json', import.meta.url)), 'utf8'),
  ) as unknown
  const index = parseRagIndex(raw)

  it('能解析，且条数与 12 本 × 8 跨页对上', () => {
    expect(index.chunks).toHaveLength(96)
  })

  it('**零个 `u/` owner**：这一份是仓库资产，任何家庭的书都不许进来', () => {
    const foreign = index.chunks.filter((chunk) => chunk.owner !== 'library')
    expect(foreign).toEqual([])
  })

  it('指纹与它自己的内容一致 → 改了语料没重跑脚本，这一条会红', () => {
    expect(index.corpusVersion).toBe(corpusVersionOf(index.chunks))
  })

  it('12 个主题一个不缺，且都是主题墙上的键', () => {
    const themes = [...new Set(index.chunks.map((chunk) => chunk.theme))].sort()
    expect(themes).toEqual([
      'balloon',
      'bird',
      'castle',
      'cloud',
      'dino',
      'flower',
      'moon',
      'paint',
      'rocket',
      'star',
      'turtle',
      'whale',
    ])
  })

  it('每一本正好 8 个跨页，年龄档是 4-6（12 本的 hero 都写着「约 5 岁」）', () => {
    const byTheme = new Map<string, number>()
    for (const chunk of index.chunks) {
      byTheme.set(chunk.theme, (byTheme.get(chunk.theme) ?? 0) + 1)
      expect(chunk.ageBand).toBe('4-6')
    }
    expect([...byTheme.values()]).toEqual(Array(12).fill(8))
  })

  it('每一条的正文都不空、且不含出处标识', () => {
    for (const chunk of index.chunks) {
      expect(chunk.text.trim()).not.toBe('')
      expect(chunk.text).not.toContain('样书')
      expect(chunk.text).not.toContain('跨页')
    }
  })
})
