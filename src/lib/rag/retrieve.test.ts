/**
 * retrieve.test.ts —— 过滤强度、隐私边界、空结果、稳定性
 *
 * 这一组用例的重点不是"能不能搜出东西"，而是**四个会被做错的地方**：
 *
 *   1. 两个极性的过滤强度不同（`example` 收相邻档，`avoid` 只守 owner 与形态）
 *   2. `owner` 是隐私边界，不是相关性偏好
 *   3. **空结果是合法结果**，不许兜底
 *   4. 同分时次序稳定（否则工单 06 的增益表会量到抖动而不是差异）
 */

import { describe, expect, it } from 'vitest'

import { ANY, buildRagIndex, type RagChunk } from './corpus.ts'
import { retrieve, retrieveBoth, type RetrieveQuery } from './retrieve.ts'

function chunk(over: Partial<RagChunk> & { id: string }): RagChunk {
  return {
    kind: 'spread',
    owner: 'library',
    ageBand: '4-6',
    theme: ANY,
    form: ANY,
    text: '小飞躺在野餐垫上，看天上的云。',
    source: `出处 ${over.id}`,
    ...over,
  }
}

const CHUNKS: RagChunk[] = [
  chunk({ id: 'library/cloud#s1', theme: 'cloud', text: '天上有一朵云，正在慢慢地变形状。' }),
  chunk({ id: 'library/cloud#s2', theme: 'cloud', text: '风轻轻地吹了一下，乌龟的背就散开了。' }),
  // ★ 这四条**只有 ageBand 不同**（主题都是 cloud、形态都是通配）。
  //   第一版 fixture 不是这么摆的，于是"相邻档收不收"那条用例其实被主题过滤器
  //   先挡掉了——测出来的是绿的，证的却是另一件事。档位这条要单独测，
  //   其余过滤器必须全部不动。
  chunk({
    id: 'library/cloud#s3',
    theme: 'cloud',
    ageBand: '4-6',
    text: '云的边上一层一层，像撕开的棉花。',
  }),
  chunk({
    id: 'library/cloud#s4',
    theme: 'cloud',
    ageBand: '6-8',
    text: '那团云越鼓越高，像一只背着山的大乌龟。',
  }),
  chunk({
    id: 'library/cloud#s5',
    theme: 'cloud',
    ageBand: '8+',
    text: '他躺在垫子上想，云的那边是不是也有人在看。',
  }),
  chunk({ id: 'library/moon#s1', theme: 'moon', text: '月亮掉进了水盆里，他端着一盆月亮。' }),
  chunk({ id: 'library/dino#s1', theme: 'dino', text: '小恐龙走进会下雨的森林。' }),
  chunk({
    id: 'u/12/books/bk_x#p1',
    owner: 'u/12',
    kind: 'page',
    form: 'solo',
    theme: 'rocket',
    text: '纸箱火箭摆在客厅中间，她给妈妈留了一个座位。',
    source: '《小雨的火箭》第 1 页',
  }),
  chunk({
    id: 'u/12/books/bk_y#p1',
    owner: 'u/12',
    kind: 'page',
    form: 'shared',
    theme: 'cloud',
    text: '云又聚成一条船，她问要不要上去。',
    source: '《云上的船》第 1 页',
  }),
  chunk({
    id: 'u/9/books/bk_z#p1',
    owner: 'u/9',
    kind: 'page',
    form: 'solo',
    theme: 'cloud',
    text: '别人家的孩子也在看云，云变成一只小狗。',
    source: '《别人家的云》第 1 页',
  }),
]

const INDEX = buildRagIndex(CHUNKS, 0)

const base: Omit<RetrieveQuery, 'polarity'> = {
  ageBand: '4-6',
  theme: 'cloud',
  form: 'solo',
  text: '云变成了一只乌龟',
  owner: 'u/12',
  k: 5,
  minScore: 0,
}

describe('硬过滤：档位、主题、形态', () => {
  it('同主题的取到，别的主题取不到（主题不是打分特征）', () => {
    const ids = retrieve({ ...base, polarity: 'example' }, INDEX).map((hit) => hit.chunk.id)
    expect(ids).toContain('library/cloud#s1')
    expect(ids).not.toContain('library/moon#s1')
  })

  it('★ `example` 收**相邻一档**：4-6 的请求能用到 6-8 的语料', () => {
    // 只收同档的后果很具体：库里 96 条全是 4-6，7 岁孩子的请求一条范例都取不到，
    // 于是这一栏对四个年龄档里的三个是哑的
    const ids = retrieve({ ...base, polarity: 'example' }, INDEX).map((hit) => hit.chunk.id)
    expect(ids).toContain('library/cloud#s1')
    expect(ids).toContain('library/cloud#s4')
  })

  it('★ 但**隔两档就不给**：4-6 的请求取不到 8+ 的句子', () => {
    const ids = retrieve({ ...base, polarity: 'example' }, INDEX).map((hit) => hit.chunk.id)
    expect(ids).not.toContain('library/cloud#s5')
  })

  it('★ 反过来也成立：8+ 的请求取得到 6-8 与 8+，取不到 4-6', () => {
    const ids = retrieve({ ...base, ageBand: '8+', polarity: 'example' }, INDEX).map(
      (hit) => hit.chunk.id,
    )
    expect(ids).toContain('library/cloud#s5')
    expect(ids).toContain('library/cloud#s4')
    expect(ids).not.toContain('library/cloud#s1')
  })

  it('形态：`shared` 的请求看不到 `solo` 的书，反过来也一样', () => {
    const shared = retrieve({ ...base, form: 'shared', polarity: 'avoid' }, INDEX).map(
      (hit) => hit.chunk.id,
    )
    expect(shared).toContain('u/12/books/bk_y#p1')
    expect(shared).not.toContain('u/12/books/bk_x#p1')
  })

  it('`form: "*"` 是通配：库里的样书对两种形态都开放', () => {
    for (const form of ['solo', 'shared'] as const) {
      const ids = retrieve({ ...base, form, polarity: 'example' }, INDEX).map((hit) => hit.chunk.id)
      expect(ids).toContain('library/cloud#s1')
    }
  })

  it('★ 主题送的是**中文名**也认（界面上走的就是这一种）', () => {
    // `src/app/create/page.tsx` 送的是 `THEMES[].label`（'云'），不是键（'cloud'）。
    // 不归一的话这个过滤器在线上一次都不会命中，而症状是"检索永远没有范例"——不报错
    const hits = retrieve({ ...base, theme: '云', polarity: 'example' }, INDEX)
    expect(hits.map((hit) => hit.chunk.id)).toContain('library/cloud#s1')
    expect(hits.map((hit) => hit.chunk.id)).not.toContain('library/moon#s1')
    expect(hits[0]?.why).toContain('同主题 cloud')
  })

  it('★ 没点主题卡（`theme` 就是家长那句话）→ **不拿它当约束**，也不谎称"同主题"', () => {
    // `lib/creation/state.ts`：`theme: form.theme.theme.trim() || wish`
    // ★ `k` 放到 10：这一档主题不筛，于是候选变多——而"别的主题能不能进"这件事
    //   在 top-5 里看不出来（前五名全是 cloud，被 `k` 截掉了，不是被筛掉的）
    const hits = retrieve(
      { ...base, theme: '第一次离开家也不怕', k: 10, polarity: 'example' },
      INDEX,
    )
    const ids = hits.map((hit) => hit.chunk.id)
    expect(ids).toContain('library/cloud#s1')
    // 这一档主题不筛，所以别的主题也能进——它诚实地写在 why 里
    expect(ids).toContain('library/moon#s1')
    expect(hits[0]?.why).toContain('这次没指定主题')
  })
})

describe('★ owner 是隐私边界', () => {
  it('`avoid` 只取自己的书 —— 别人家的孩子读过的，不算他读过', () => {
    const ids = retrieve({ ...base, polarity: 'avoid' }, INDEX).map((hit) => hit.chunk.id)
    expect(ids).not.toContain('u/9/books/bk_z#p1')
    expect(ids.every((id) => id.startsWith('u/12/'))).toBe(true)
  })

  it('`example` 也只给"库 + 自己"，别人的书一条都进不来', () => {
    const ids = retrieve({ ...base, polarity: 'example' }, INDEX).map((hit) => hit.chunk.id)
    expect(ids).not.toContain('u/9/books/bk_z#p1')
  })

  it('换一个 owner，取到的是另一个人的那一片', () => {
    const mine = retrieve({ ...base, owner: 'u/9', polarity: 'avoid' }, INDEX).map(
      (hit) => hit.chunk.id,
    )
    expect(mine).toContain('u/9/books/bk_z#p1')
    expect(mine.some((id) => id.startsWith('u/12/'))).toBe(false)
  })
})

describe('★ 空结果是合法结果', () => {
  it('过滤全落空 → `[]`（不抛错、不兜底"随便给几条"）', () => {
    // ★ 用**真主题键**（'bird' 是主题墙上的键，只是这份测试索引里没有它的 chunk）
    //   来造"筛空"。原来这里写的是 `theme: '没有这个主题'`——那在主题归一之后
    //   **不再是"筛空"了**：认不出来的主题就是"这次没指定主题"，于是不筛（见 `themeKeyOf`）。
    //   这一条当场红过一次，红的正是那个语义变化。
    expect(retrieve({ ...base, theme: 'bird', polarity: 'example' }, INDEX)).toEqual([])
  })

  it('高于任何分数都达不到的阈值 → `[]`', () => {
    expect(retrieve({ ...base, minScore: 999, polarity: 'example' }, INDEX)).toEqual([])
  })

  it('查询串没有词 → 全 0 分，阈值一卡就空', () => {
    expect(
      retrieve({ ...base, text: '，。', minScore: 0.001, polarity: 'example' }, INDEX),
    ).toEqual([])
  })

  it('k = 0 或空索引 → `[]`', () => {
    expect(retrieve({ ...base, k: 0, polarity: 'example' }, INDEX)).toEqual([])
    expect(retrieve({ ...base, polarity: 'example' }, buildRagIndex([], 0))).toEqual([])
  })
})

describe('排序与截断', () => {
  it('分高的在前', () => {
    const hits = retrieve({ ...base, polarity: 'example' }, INDEX)
    const scores = hits.map((hit) => hit.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it('★ 同分按 id 升序：次序稳定，两次跑出来一样', () => {
    // 查询与所有候选都不匹配 → 全 0 分（minScore 取 0 时它们都留下）
    const hits = retrieve(
      { ...base, text: '完全不搭界的字', minScore: 0, polarity: 'example' },
      INDEX,
    )
    const ids = hits.map((hit) => hit.chunk.id)
    expect(ids).toEqual([...ids].sort())
  })

  it('top-k 截断', () => {
    expect(retrieve({ ...base, k: 2, polarity: 'example' }, INDEX)).toHaveLength(2)
  })

  it('`why` 说得清为什么（含命中数），不是一句空话', () => {
    const [hit] = retrieve({ ...base, polarity: 'example' }, INDEX)
    expect(hit?.why).toContain('命中')
    expect(hit?.why).toContain('同主题 cloud')
    expect(hit?.why).toContain('同档 4-6')
  })

  it('反例的 `why` 说的是"你已经给他写过"，不是档位', () => {
    const [hit] = retrieve({ ...base, polarity: 'avoid' }, INDEX)
    expect(hit?.why).toContain('你已经给他写过')
  })
})

describe('retrieveBoth：正反不重叠', () => {
  it('一条 chunk 不许同时出现在两栏里（那会让提示词自相矛盾）', () => {
    const { examples, avoids } = retrieveBoth(base, INDEX)
    const avoidIds = new Set(avoids.map((hit) => hit.chunk.id))
    for (const hit of examples) expect(avoidIds.has(hit.chunk.id)).toBe(false)
  })

  it('两栏各自都取得到东西（这条场景下）', () => {
    const { examples, avoids } = retrieveBoth(base, INDEX)
    expect(examples.length).toBeGreaterThan(0)
    // base 的 form 是 solo，所以「已经写过」这一栏里是那本独读版，不是共读版那本
    expect(avoids.map((hit) => hit.chunk.id)).toEqual(['u/12/books/bk_x#p1'])
  })
})

/**
 * 阈值分两档（2026-10-19，判据 4 第二轮）。
 *
 * ★ 这几条用例的阈值刻意写成 `minScore: 999`：那样"取到了"就**只可能**是因为
 *   走了低阈值那一档——比用一个"刚好卡在中间"的数更能说明它测的是分档本身，
 *   而且不会因为 BM25 的 idf 随语料变化而变红（`load.test.ts` 记过这个坑）。
 * ★ 每一条都自带一句**与目标 chunk 有 bigram 重合**的查询串：
 *   fixture 里那个默认查询（"云变成了一只乌龟"）与几条候选的分数都是 0，
 *   拿它测"放宽之后取到了"会红在一件与分档无关的事上。
 */
describe('★ 阈值按池子的收窄程度分档', () => {
  const NARROW = { minScore: 999, narrowedMinScore: 0.5 }

  it('请求里认得出主题 ⇒ 同主题的候选走低阈值（字符重合只是"同主题"的代理）', () => {
    const hits = retrieve(
      { ...base, text: '云正在慢慢地变形状', ...NARROW, polarity: 'example' },
      INDEX,
    )
    expect(hits.map((hit) => hit.chunk.id)).toContain('library/cloud#s1')
    // ★ 别的主题的候选本来就被硬过滤挡着，不因放宽而进来
    expect(hits.map((hit) => hit.chunk.id)).not.toContain('library/moon#s1')
  })

  it('★ 一条靠放宽进来的条目，`why` 里要写得出这件事（可解释性不许打折）', () => {
    const hit = retrieve(
      { ...base, text: '云正在慢慢地变形状', ...NARROW, polarity: 'example' },
      INDEX,
    ).find((row) => row.chunk.id === 'library/cloud#s1')
    expect(hit?.why).toContain('池子已收窄')
  })

  it('★ 请求里**认不出主题** ⇒ 池子是整座库，仍然用高阈值（低阈值会把不相关的范例喂进去）', () => {
    const nothing = retrieve(
      {
        ...base,
        theme: '他今天不想睡觉',
        text: '云正在慢慢地变形状',
        ...NARROW,
        polarity: 'example',
      },
      INDEX,
    )
    expect(nothing).toEqual([])
  })

  it('★ `avoid` 永远走低阈值：它的池子被 owner 收窄，"他读过了"是硬事实', () => {
    const hits = retrieve(
      { ...base, text: '纸箱火箭摆在客厅中间', ...NARROW, polarity: 'avoid' },
      INDEX,
    )
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.chunk.owner === 'u/12')).toBe(true)
  })

  it('不给 `narrowedMinScore` = 老行为（只有一个阈值，向后兼容）', () => {
    const hits = retrieve(
      { ...base, text: '云正在慢慢地变形状', minScore: 999, polarity: 'example' },
      INDEX,
    )
    expect(hits).toEqual([])
  })
})

describe('★ 收窄只放宽、不收严', () => {
  it('`minScore: 0`（谁来都得留着）不会被同主题那一档悄悄抬到 1', () => {
    // ★ 这条是 `load.test.ts` 那条合成用例当场抓到的：`minScore: 0` 是"0 分门槛"，
    //   而带主题的请求若被 `narrowedMinScore` 抬到 1，那个名字就不成立了——
    //   失败长成"正例一条都取不到"，看着像检索坏了，其实是阈值被偷换了
    const hits = retrieve(
      {
        ...base,
        text: '云正在慢慢地变形状',
        minScore: 0,
        narrowedMinScore: 1,
        polarity: 'example',
      },
      INDEX,
    )
    expect(hits.map((hit) => hit.chunk.id)).toContain('library/cloud#s1')
  })

  it('反过来：`minScore: 2` + `narrowedMinScore: 1` ⇒ 同主题那一档真的降到 1', () => {
    const hits = retrieve(
      {
        ...base,
        text: '云正在慢慢地变形状',
        minScore: 2,
        narrowedMinScore: 1,
        polarity: 'example',
      },
      INDEX,
    )
    expect(hits.length).toBeGreaterThan(0)
  })
})
