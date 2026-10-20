/**
 * reader-model.test.ts —— 锁住"**一页 = 一个跨页 = 一张图**"
 *
 * ★ 这一组测的不是几何（那个在 flip.ts，而且它一直是对的），是**每一面装什么**。
 *   2026-10-15 之前的形状是每一面装一整页，翻开一屏 = 左右各一张不同的图；
 *   而"一页图配一页字"与"一张横图在书脊处切开"在类型上完全一样，闸门抓不到。
 *   下面那几条断言就是那次返工留下的判据——把页模型改回两面各一张图，它们会红。
 */

import { describe, expect, it } from 'vitest'

import {
  autoCueOf,
  choiceClipsOf,
  choiceScreenOf,
  leafCountOf,
  maxLeafOf,
  openingOf,
  pathPages,
  readerFaces,
  readoutOf,
  showsText,
  storyPath,
} from './reader-model.ts'
import type {
  ReaderPage,
  ResolvedStory,
  StoryChoiceView,
  StoryOptionView,
  StoryView,
} from '@/lib/book-source.ts'

function page(pageNo: number, body: readonly string[] = ['一句。']): ReaderPage {
  return {
    pageNo,
    imageUrl: `books/b1/page-${pageNo}-a1.png`,
    audioUrl: null,
    body,
    missing: false,
  }
}

const PAGES = [page(1), page(2), page(3)]

describe('面表：一页的两半是**同一张图**', () => {
  it('面数 = 2 × 页数 + 2（封面 + 每页两半 + 封底）', () => {
    expect(readerFaces(PAGES)).toHaveLength(2 * PAGES.length + 2)
  })

  it('叶数 = 页数 + 1（flip.ts 的叶表：N 个跨页要 N+1 叶）', () => {
    expect(leafCountOf(PAGES)).toBe(PAGES.length + 1)
    expect(readerFaces(PAGES)).toHaveLength(2 * leafCountOf(PAGES))
  })

  it('★ 同一个 opening 的左右半指着**同一个 page 对象**——不是两张不同的图', () => {
    const faces = readerFaces(PAGES)
    for (let k = 1; k <= PAGES.length; k++) {
      const left = faces[2 * k - 1]
      const right = faces[2 * k]
      expect(left?.kind).toBe('art')
      expect(right?.kind).toBe('art')
      if (left?.kind !== 'art' || right?.kind !== 'art') return
      expect(left.half).toBe('left')
      expect(right.half).toBe('right')
      // 同一张图（对象同一个）——"左右各一个"就是把这里换成两张不同的图
      expect(left.page).toBe(right.page)
      expect(left.page.pageNo).toBe(k)
    }
  })

  it('★ openingOf 把这两半算成同一个 opening（挂图窗口按它算）', () => {
    for (let k = 1; k <= PAGES.length; k++) {
      expect(openingOf(2 * k - 1)).toBe(k)
      expect(openingOf(2 * k)).toBe(k)
    }
    // 两个端点：封面在 0，封底在 leafCount
    expect(openingOf(0)).toBe(0)
    expect(openingOf(readerFaces(PAGES).length - 1)).toBe(leafCountOf(PAGES))
  })

  it('封面在最前、封底在最后（顺序错了翻出来的第一屏不是封面）', () => {
    const faces = readerFaces(PAGES)
    expect(faces[0]?.kind).toBe('cover')
    expect(faces[faces.length - 1]?.kind).toBe('back')
  })

  it('没有页的书只剩封面与封底，不抛', () => {
    expect(readerFaces([]).map((face) => face.kind)).toEqual(['cover', 'back'])
    expect(leafCountOf([])).toBe(1)
  })
})

describe('正文只跟左半走', () => {
  it('同一页的两个半页：左半出正文，右半不出', () => {
    const faces = readerFaces([page(1, ['第一句。', '第二句。'])])
    expect(showsText(faces[1]!)).toBe(true)
    expect(showsText(faces[2]!)).toBe(false)
  })

  it('封面与封底不出正文（它们是 kind，不是空的 page）', () => {
    const faces = readerFaces(PAGES)
    expect(showsText(faces[0]!)).toBe(false)
    expect(showsText(faces[faces.length - 1]!)).toBe(false)
  })

  it('正文是空数组时不出一块空的字（不是"能出却没出"）', () => {
    const faces = readerFaces([page(1, [])])
    expect(showsText(faces[1]!)).toBe(false)
  })
})

describe('页码：封面与封底**不是页**', () => {
  it('翻开一屏报一页，不是"第 1–2 页"', () => {
    expect(readoutOf(1, PAGES)).toEqual({ label: '第 1 页', page: 1 })
    expect(readoutOf(2, PAGES)).toEqual({ label: '第 2 页', page: 2 })
  })

  it('两端是封面与封底，page 为 null', () => {
    expect(readoutOf(0, PAGES)).toEqual({ label: '封面', page: null })
    expect(readoutOf(leafCountOf(PAGES), PAGES)).toEqual({ label: '封底', page: null })
  })

  it('★ 封底的 page **不是** pages.length —— 那个哨兵恰好等于最后一页的页码', () => {
    // 这条是这次一起修掉的缺陷：`page: pages.length` 会让下游把"停在封底"读成
    // "在第 P 页"，于是朗读按钮亮着、阅读时长也记到最后一页头上
    const last = readoutOf(leafCountOf(PAGES), PAGES)
    expect(last.page).toBeNull()
    expect(last.page).not.toBe(PAGES.length)
  })

  it('半翻状态下报的是**正在翻向**的那一页（四舍五入，不出现第 1.5 页）', () => {
    expect(readoutOf(1.4, PAGES)).toEqual({ label: '第 1 页', page: 1 })
    expect(readoutOf(1.6, PAGES)).toEqual({ label: '第 2 页', page: 2 })
  })

  it('越界的 q 不抛，报最接近的那一端', () => {
    expect(readoutOf(-3, PAGES).label).toBe('封面')
    expect(readoutOf(99, PAGES).label).toBe('封底')
  })
})

describe('自动朗读：第 opening 屏该念哪儿', () => {
  const COUNT = PAGES.length

  it('第 k 屏念第 k 屏', () => {
    for (let k = 1; k <= COUNT; k++) {
      expect(autoCueOf(k, COUNT)).toEqual({ kind: 'speak', screen: k })
    }
  })

  it('★ 封面是 begin，不是"没有可念的"', () => {
    // `readoutOf` 在封面给的是 `page: null`，但那句话在这里不够用：
    // 跟着那个 null 走，按一次「自动朗读」就是一句也不念
    expect(autoCueOf(0, COUNT)).toEqual({ kind: 'begin' })
    expect(readoutOf(0, PAGES).page).toBeNull()
  })

  it('★ 封底是 done —— 边界是 `屏数 + 1`，不是 `屏数`', () => {
    // 差一写法的症状：最后一屏被念两遍（一遍算"第 N 屏"、一遍算"封底"），
    // 或者最后一屏永远轮不到 —— 那个哨兵值与 `readoutOf` 那条注释同源
    expect(autoCueOf(leafCountOf(PAGES), COUNT)).toEqual({ kind: 'done' })
    expect(autoCueOf(COUNT, COUNT)).toEqual({ kind: 'speak', screen: COUNT })
  })

  it('越界不抛：负数当封面、超出的当封底', () => {
    expect(autoCueOf(-3, COUNT)).toEqual({ kind: 'begin' })
    expect(autoCueOf(99, COUNT)).toEqual({ kind: 'done' })
  })

  it('空书（封面紧挨着封底）两个端点都认得出，不会去念第 1 屏', () => {
    expect(autoCueOf(0, 0)).toEqual({ kind: 'begin' })
    expect(autoCueOf(1, 0)).toEqual({ kind: 'done' })
  })
})

/* ═════════════════════ 共读版：阅读顺序是**那条路**，不是页号 ═════════════════════ */

function option(label: string): StoryOptionView {
  return { label, spoken: label, emoji: '✨', iconUrl: null, audioUrl: `a/${label}.mp3` }
}

const CHOICE: StoryChoiceView = {
  prompt: '走哪边？',
  promptAudioUrl: 'a/ask.mp3',
  options: [option('走左边'), option('走右边')],
}

function view(
  pageNo: number,
  next: string[] = [],
  choice: StoryChoiceView | null = null,
): StoryView {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    body: [`第 ${pageNo} 页的正文。`],
    imageUrl: `books/b1/page-${pageNo}-a1.png`,
    audioUrl: `books/b1/page-${pageNo}-a1.mp3`,
    missing: false,
    next,
    choice,
  }
}

/**
 * 一棵带岔路的树：1 → 2 → 3（选择点）→ a 支 4 收尾 / b 支 5 → 6 收尾。
 *
 * ★ 两支的页号**交错**是刻意的：平铺顺序长这样 `1,2,3,4,5,6`，而**任何一条真实的
 *   阅读路径都不长这样**（走 b 支的人永远见不到第 4 页）。这不是难看的构造——
 *   它就是"预生成"的形状：钱在生成那一刻花完了，走不到的那一支也在书里。
 * ★ 页数差 1（a 支 4 页、b 支 5 页）取在 `tree.ts` 允许的边界上。
 */
const SHARED: ResolvedStory = {
  form: 'shared',
  rootId: 'n1',
  nodes: [
    view(1, ['n2']),
    view(2, ['n3']),
    view(3, ['n4', 'n5'], CHOICE),
    view(4),
    view(5, ['n6']),
    view(6),
  ],
}

describe('故事路径：没选之前停在选择点上', () => {
  it('没选过 → 路走到选择点为止（"到目前为止他能读到的那些页"）', () => {
    expect(storyPath(SHARED, null).map((node) => node.pageNo)).toEqual([1, 2, 3])
  })

  it('选了哪一支就走哪一支，到叶为止', () => {
    expect(storyPath(SHARED, 'a').map((node) => node.pageNo)).toEqual([1, 2, 3, 4])
    expect(storyPath(SHARED, 'b').map((node) => node.pageNo)).toEqual([1, 2, 3, 5, 6])
  })

  it('★ 平铺顺序**不等于任何一条路** —— 这就是"不许拿全表当阅读顺序"', () => {
    const flat = SHARED.nodes.map((node) => node.pageNo)
    expect(flat).toEqual([1, 2, 3, 4, 5, 6])
    for (const pick of [null, 'a', 'b'] as const) {
      expect(storyPath(SHARED, pick).map((node) => node.pageNo)).not.toEqual(flat)
    }
    // 症状具体长这样：走 b 支的孩子，屏幕上一页都不会出现第 4 页（a 支那一页）
    expect(storyPath(SHARED, 'b').map((node) => node.pageNo)).not.toContain(4)
  })

  it('★ 走不到的支**一页都不算进来**——图与音所属的页表就是这么短下来的', () => {
    // 阅读器只按这条路挂图/取音（`narrationUrls` 也是它算的），所以"a 支的图与音频
    // 一次都没被请求"这条验收在模型这一层就是这个断言；浏览器那一半看 network 面板
    const pages = pathPages(storyPath(SHARED, 'b'))
    expect(pages.map((page) => page.pageNo)).toEqual([1, 2, 3, 5, 6])
  })

  it('一个人的书（独读版）就是一条链：任何 pick 都等于全表', () => {
    const solo: ResolvedStory = {
      form: 'solo',
      rootId: 'n1',
      nodes: [view(1, ['n2']), view(2, ['n3']), view(3)],
    }
    const flat = solo.nodes.map((node) => node.pageNo)
    for (const pick of [null, 'a', 'b'] as const) {
      expect(storyPath(solo, pick).map((node) => node.pageNo)).toEqual(flat)
    }
  })

  it('盘上的 JSON 被手改出环也不会把服务端渲染挂死', () => {
    const broken: ResolvedStory = {
      form: 'solo',
      rootId: 'n1',
      nodes: [view(1, ['n2']), view(2, ['n1'])],
    }
    expect(storyPath(broken, null).map((node) => node.pageNo)).toEqual([1, 2])
  })

  it('根不在表里 / 空表 → 空路，不抛（封面紧挨着封底）', () => {
    expect(storyPath({ form: 'solo', rootId: 'nope', nodes: [view(1)] }, null)).toEqual([])
    expect(readerFaces(pathPages([])).map((face) => face.kind)).toEqual(['cover', 'back'])
  })
})

describe('页码：给人看的那个数是**这条路上的序号**，不是资产编号', () => {
  const pages = pathPages(storyPath(SHARED, 'b'))

  it('★ 路径第 4 页的资产编号是 5 —— 两个数必须分开', () => {
    // 报资产编号的症状：走 b 支的孩子读到第 4 页，底栏说"第 5 页"，家长以为漏读了一页
    expect(readoutOf(4, pages)).toEqual({ label: '第 4 页', page: 5 })
  })

  it('两端仍然是封面与封底（路变短了，端点跟着走）', () => {
    expect(readoutOf(0, pages)).toEqual({ label: '封面', page: null })
    expect(readoutOf(leafCountOf(pages), pages)).toEqual({ label: '封底', page: null })
  })

  it('阅读记录记的仍然是资产编号（`page` 那一栏）', () => {
    expect(readoutOf(5, pages).page).toBe(6)
  })
})

describe('选择点那一屏', () => {
  it('浮在选择点那一屏上，别处是 null', () => {
    const path = storyPath(SHARED, null)
    expect(choiceScreenOf(path, 3)).toBe(CHOICE)
    expect(choiceScreenOf(path, 1)).toBeNull()
    expect(choiceScreenOf(path, 0)).toBeNull()
  })

  it('★ 选过之后**回翻**，那一屏仍然是选择点（按下态才有地方还原、才改得动）', () => {
    expect(choiceScreenOf(storyPath(SHARED, 'a'), 3)).toBe(CHOICE)
    expect(choiceScreenOf(storyPath(SHARED, 'b'), 3)).toBe(CHOICE)
  })

  it('路比一到那儿就短了（选完 b 支之后再问第 4 屏）→ null，不抛', () => {
    expect(choiceScreenOf(storyPath(SHARED, null), 4)).toBeNull()
  })
})

describe('选择点要念的三段：顺序就是按钮的左右顺序', () => {
  it('★ 提问 → 选项 A → 选项 B（options[0] 就是 via=a 那一支）', () => {
    // 顺序错的症状：念的是"我想去找找星星屋"、亮起来的是左边那颗彩虹桥——
    // 屏幕上没有任何东西会说出这件事，所以它只能靠这条断言守着
    expect(choiceClipsOf(CHOICE)).toEqual(['a/ask.mp3', 'a/走左边.mp3', 'a/走右边.mp3'])
  })

  it('★ 缺一段就**留在原位**当 null，不把数组压短', () => {
    // 压短的后果是下标与选项对不上：`clips[1]` 会变成右边的选项，
    // 而"缺一段就不念"那条判据（`every(url => url !== null)`）本来就在调用方
    const missing: StoryChoiceView = {
      ...CHOICE,
      options: [{ ...option('走左边'), audioUrl: null }, option('走右边')],
    }
    expect(choiceClipsOf(missing)).toEqual(['a/ask.mp3', null, 'a/走右边.mp3'])
  })
})

describe('没选之前 `›` 的上界：封底那一片叶不给', () => {
  const blockedAtChoice = pathPages(storyPath(SHARED, null))

  it('★ 挡住的是"越过选择点"，少给的正好是**封底那一片叶**', () => {
    expect(maxLeafOf(blockedAtChoice, true)).toBe(leafCountOf(blockedAtChoice) - 1)
    expect(leafCountOf(blockedAtChoice)).toBe(4) // 3 页 + 封面 → 4 片叶
  })

  it('不挡的时候拿满（独读版与选过的共读版都不改量程）', () => {
    const solo = pathPages(storyPath(SHARED, 'a'))
    expect(maxLeafOf(solo, false)).toBe(leafCountOf(solo))
  })
})
