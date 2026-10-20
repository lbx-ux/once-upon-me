/**
 * review.test.ts —— 内容审核这道闸（`.scratch/rag` 工单 05，评分表 #5）
 *
 * 六组，每组盯一件只会**悄悄**坏掉的事：
 *
 * 1. **词表档本身**：命中的报出条款 id 与上下文；去空白之后也命中；同一条款只报一次；
 *    以及**单字词的收法**（`砍柴` / `鬼点子` / `丑小鸭` / `打伞` 不许命中——
 *    误拦与漏拦一样贵，理由在 `rag/review-corpus.ts` 文件头第三节）。
 * 2. **裁决**：`rewrite` → `flag`（要改一版）、`block` → `block`（当场拒发）、
 *    两者同时命中时取 `block`。★ `flag` 不是"提示一下照样放行"，它在闸门上是"这一版不能出去"。
 * 3. **审到哪些字**：书名、`scene`、`imagePrompt`、选择点的 `spoken`——
 *    漏掉任何一处，那一处就是一道没有闸门的门（`spoken` 会被念出来，
 *    `imagePrompt` 会被画出来）。
 * 4. **反例**：12 本人工写过的真样书，96 段正文一条都不许命中。
 *    ★ 这一组比正向用例更要紧——这个项目在「空值算不算错」那节付过一次假拦的学费：
 *      误拦会让一本**正常的**书变成"生成失败"，而家长没有任何办法绕过它。
 * 5. **闸门真的接上了**（`planStory`）：`flag` 带反馈重写且原因**具体到条款 id**、
 *    `block` 当场抛 `review-blocked` **不重试**（只调一次模型）、干净的一版一个
 *    `review` 事件都不发。
 * 6. **家长走的那条路**（`planBook`）也拦得住。
 *
 * ★ 树的造法一律走 `buildTree`（引擎自己那一步），不手搓 `StoryTree`：
 *   手搓出来的那棵树只满足**测试作者以为的**形状，而闸门读的是真树的字段。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BOOKLIST } from '../../components/booklist/booklist.ts'
import { REVIEW_CLAUSES } from '../rag/review-corpus.ts'
import type { NodeDraft } from '../schemas/story.ts'
import {
  planBook,
  illustrateBook,
  type BookRequest,
  type CharacterCard,
  type EngineEvent,
} from './index.ts'
import { planStory } from './plan.ts'
import { createMemoryStore } from './providers/stores.ts'
import type {
  ImageGenerator,
  ProviderBundle,
  TextGenerator,
  TextResponse,
} from './providers/types.ts'
import { buildTree } from './tree.ts'
import { reviewInput, reviewInputText, reviewPages, reviewStory, reviewText } from './review.ts'
import { THEMES } from '../themes.ts'
import type { StoryPlanInput } from '../prompts/story-plan.ts'

/** 12 个预设主题的中文名。★ 从 `THEMES` 取而不是抄一份：抄的那一份会漂 */
const THEME_LABELS = THEMES.map((theme) => theme.label)

/** 一版干净的故事：三页、独读版、无一处碰词表 */
const CLEAN_PAGES: NodeDraft[] = [
  {
    scene: '她把天空涂成绿色',
    body: ['她把天空涂成了绿色。'],
    imagePrompt: '小女孩站在窗前，窗外一整片绿',
    mood: 'wonder',
  },
  {
    scene: '绿色从窗缝里漏出去',
    body: ['绿色顺着窗缝漏了出去。'],
    imagePrompt: '绿色的光从窗缝漏到街上',
    mood: 'joy',
  },
  {
    scene: '整座城都绿了，她困了',
    body: ['整座城都绿了。', '她合上了眼睛。'],
    imagePrompt: '绿光里的小床，孩子睡着',
    mood: 'tender',
  },
]

const CLEAN_TITLE = '小乐的绿天空'
const CLEAN_JSON = JSON.stringify({ title: CLEAN_TITLE, nodes: CLEAN_PAGES })

/** 把干净那一版里的某一页换掉几格，造一个越线的版本 */
function draftWith(index: number, override: Partial<NodeDraft>): string {
  return JSON.stringify({
    title: CLEAN_TITLE,
    nodes: CLEAN_PAGES.map((page, i) => (i === index ? { ...page, ...override } : page)),
  })
}

/** 造一棵真树（过了 `buildTree` 那一关，与流水线里闸门看到的是同一形状） */
function treeOf(pages: readonly NodeDraft[], title = CLEAN_TITLE) {
  const built = buildTree('solo', title, pages)
  if (!built.ok)
    throw new Error(`测试的树不合法：${built.problems.map((p) => p.message).join('；')}`)
  return built.tree
}

/**
 * 假文本：按队列回话。★ 先取这一轮的回复**再**自增——反过来写的话第一次拿到的
 * 就是 `replies[1]`，那条"带反馈重写"的用例会当场变成"一次就过"（真错过一次，
 * 红得很安静；同一条坑见 `plan-retrieval.test.ts`）。
 */
function fakeText(replies: readonly string[]): { text: TextGenerator; calls: () => number } {
  let index = 0
  const respond = (): TextResponse => {
    const text = replies[Math.min(index, replies.length - 1)] ?? CLEAN_JSON
    index += 1
    return { text, modelId: 'fake-text' }
  }
  return {
    calls: () => index,
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete() {
        return respond()
      },
      async stream(_req, _budget, onDelta) {
        const response = respond()
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
  }
}

const INPUT: StoryPlanInput = {
  childName: '小乐',
  nameReading: 'xiǎo lè',
  ageBand: '4-6',
  interestTags: ['云'],
  lookTags: ['短发'],
  theme: 'cloud',
  form: 'solo',
  pages: 3,
}

function emitter(): { events: EngineEvent[]; emit: (payload: Record<string, unknown>) => void } {
  const events: EngineEvent[] = []
  let seq = 0
  return {
    events,
    emit: (payload) => {
      seq += 1
      events.push({ seq, at: 0, stage: 'planning', ...payload } as unknown as EngineEvent)
    },
  }
}

async function runPlan(
  replies: readonly string[],
): Promise<{ events: EngineEvent[]; attempts: number; error: unknown }> {
  const { text } = fakeText(replies)
  const { events, emit } = emitter()
  try {
    const outcome = await planStory(INPUT, { text, form: 'solo', emit })
    return { events, attempts: outcome.attempts, error: null }
  } catch (error) {
    return { events, attempts: 0, error }
  }
}

describe('① 词表档', () => {
  it('命中时给得出条款 id、类别、处置、命中的词与上下文', () => {
    const problems = reviewText('他站在门口，血从窗帘后面渗出来。')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({
      clauseId: 'R-01',
      category: '恐怖',
      disposition: 'rewrite',
      word: '血',
    })
    // `context` 取的是**原文**里那一小段（给人一眼确认用的），不是被我们改过的那份
    expect(problems[0]?.context).toContain('血从窗帘')
  })

  it('★ 去掉空白之后也命中：`自 杀` 这种插空格不算绕过词表', () => {
    expect(reviewText('自 杀').map((problem) => problem.clauseId)).toEqual(['R-04'])
  })

  it('同一条款只报一次：一页里三个"血"，家长要改的是那一页', () => {
    const problems = reviewText('血。血。还是血。')
    expect(problems).toHaveLength(1)
    expect(problems[0]?.clauseId).toBe('R-01')
  })

  it('★ 单字只收没有第二种意思的：砍柴 / 鬼点子 / 丑小鸭 / 打伞 都不许命中', () => {
    for (const text of [
      '他去山里砍柴。',
      '这是一个鬼点子。',
      '丑小鸭慢慢长大了。',
      '她打着伞走过小路。',
    ]) {
      expect(reviewText(text), text).toEqual([])
    }
  })

  it('空串与纯空白不是"命中"，也不是"有问题"', () => {
    expect(reviewText('')).toEqual([])
    expect(reviewText('   \n ')).toEqual([])
  })
})

describe('② 裁决：rewrite → flag，block → block，两者都有取 block', () => {
  it('rewrite 条款命中 → flag（不是"照样放行"）', () => {
    const [page] = reviewPages([{ pageNo: 1, texts: ['天上有一朵云。', '他害怕得尖叫。'] }])
    expect(page?.verdict).toBe('flag')
  })

  it('block 条款命中 → block', () => {
    const [page] = reviewPages([{ pageNo: 1, texts: ['他在厨房里玩火。'] }])
    expect(page?.verdict).toBe('block')
  })

  it('同一页既有 block 又有 rewrite → block（重的那一条说话）', () => {
    const [page] = reviewPages([{ pageNo: 1, texts: ['他玩火，然后尖叫起来。'] }])
    expect(page?.verdict).toBe('block')
    expect(page?.problems.map((problem) => problem.clauseId).sort()).toEqual(['R-01', 'R-06'])
  })
})

describe('③ reviewStory 审到哪些字', () => {
  it('干净的一版 pass，且 `unchecked` 如实列出今天没判据的那几条', () => {
    const result = reviewStory(treeOf(CLEAN_PAGES))
    expect(result.verdict).toBe('pass')
    expect(result.pages.every((page) => page.verdict === 'pass')).toBe(true)
    // ★ `pass` **不等于**"全查过了"：语义档那三条今天没有判据（`review.ts` 文件头第三节），
    //   所以要说得出来是哪三条。少了这一条，这个字段会退化成"永远是空的"。
    expect(result.unchecked).toEqual(
      REVIEW_CLAUSES.filter((clause) => clause.detect === 'semantic').map((clause) => clause.id),
    )
    expect(result.unchecked.length).toBeGreaterThan(0)
  })

  it('画面描述里的人也得审：`scene` 与 `imagePrompt` 都不进耳朵但进眼睛', () => {
    const result = reviewStory(
      treeOf([
        { ...(CLEAN_PAGES[0] as NodeDraft), imagePrompt: '草地上躺着一具尸体' },
        ...CLEAN_PAGES.slice(1),
      ]),
    )
    expect(result.verdict).toBe('flag')
    expect(result.pages.find((page) => page.pageNo === 1)?.problems[0]?.clauseId).toBe('R-01')
  })

  it('选择点的两个选项都要审：`spoken` 会被念出来', () => {
    // 共读版一棵最小的合法树：选择点在第 2 页，两条支各一页，最后合流一页
    const choicePage: NodeDraft = {
      ...(CLEAN_PAGES[1] as NodeDraft),
      ask: '你觉得他该走哪条路？',
      labelA: '近路',
      spokenA: '走那条很恐怖的巷子',
      iconA: 'a',
      emojiA: '🅰',
      labelB: '远路',
      spokenB: '绕远路',
      iconB: 'b',
      emojiB: '🅱',
    }
    const built = buildTree('shared', CLEAN_TITLE, [
      CLEAN_PAGES[0] as NodeDraft,
      choicePage,
      { ...(CLEAN_PAGES[2] as NodeDraft), from: 2, via: 'a' },
      {
        scene: '绕远路上有一片花',
        body: ['花在风里点着头。'],
        imagePrompt: '小路两旁的花',
        mood: 'calm',
        from: 2,
        via: 'b',
      },
      { ...(CLEAN_PAGES[2] as NodeDraft), from: 4 },
    ])
    if (!built.ok)
      throw new Error(`共读版的树不合法：${built.problems.map((p) => p.message).join('；')}`)
    const result = reviewStory(built.tree)
    expect(result.verdict).toBe('flag')
    expect(result.pages.find((page) => page.pageNo === 2)?.problems[0]?.clauseId).toBe('R-01')
    expect(result.pages.find((page) => page.pageNo === 2)?.problems[0]?.word).toBe('恐怖')
  })

  it('书名也要审（页号 0 那一格）', () => {
    const result = reviewStory(treeOf(CLEAN_PAGES, '小乐的死亡之旅'))
    expect(result.verdict).toBe('flag')
    expect(result.pages.find((page) => page.pageNo === 0)?.problems[0]?.clauseId).toBe('R-03')
  })
})

describe('④ 反例：12 本真样书一段都不许误拦', () => {
  it('96 段正文 + 96 个跨页短名 + 12 个书名，零命中', () => {
    const hits: string[] = []
    for (const book of BOOKLIST) {
      const parts: [string, string][] = [[`书名《${book.title}》`, book.title]]
      book.spreads.forEach((spread, index) => {
        parts.push([`《${book.title}》第 ${index + 1} 跨页短名`, spread.caption])
        spread.text.forEach((line, lineIndex) => {
          parts.push([`《${book.title}》第 ${index + 1} 跨页第 ${lineIndex + 1} 行`, line])
        })
      })
      for (const [where, text] of parts) {
        for (const problem of reviewText(text)) {
          hits.push(`${where}：${problem.clauseId}「${problem.word}」`)
        }
      }
    }
    // ★ 断言写成这样是为了让红的时候**直接看得到是哪一段哪一个词**——
    //   一句 `expect(hits).toEqual([])` 只会给一个空数组（本仓库已有先例）
    expect(hits).toEqual([])
    // 顺带证明这一组真的跑到了 12 本（一个空循环也会"通过"）
    expect(BOOKLIST).toHaveLength(12)
    expect(BOOKLIST.flatMap((book) => book.spreads)).toHaveLength(96)
  })

  it('stub 那一版 demo 故事（`engine-run --mode=stub` 用的那一份）也零命中', async () => {
    // ★ 它也是**人写的**，而且是每次架构验收都会真的过一遍闸门的那一份
    //   （`scripts/engine-run.mts` 把它当规划的替身）。放进这一组是因为
    //   上面那 96 段样书**不是**它们那种形状：样书没有 `scene` / `imagePrompt` /
    //   选择点，而这一份有。上一版的 `点着`（"点着头"）就是被这一类句子抓出来的。
    const raw = await readFile(join(process.cwd(), 'scripts/fixtures/demo-plan.json'), 'utf8')
    const plan = JSON.parse(raw) as {
      title: string
      nodes: { scene: string; body: string[]; imagePrompt: string }[]
    }
    const hits = [
      ...reviewText(plan.title).map((problem) => `书名：${problem.clauseId}「${problem.word}」`),
      ...plan.nodes.flatMap((node, index) =>
        [node.scene, ...node.body, node.imagePrompt].flatMap((text) =>
          reviewText(text).map(
            (problem) =>
              `第 ${index + 1} 页：${problem.clauseId}「${problem.word}」（${text.slice(0, 12)}）`,
          ),
        ),
      ),
    ]
    expect(hits).toEqual([])
  })
})

describe('⑤ 闸门接上了：planStory 的 flag 与 block', () => {
  it('flag：带反馈重写一版，重试原因里带着条款 id', async () => {
    const { events, attempts } = await runPlan([
      draftWith(0, { body: ['他站在门口，血从窗帘后面渗出来。'] }),
      CLEAN_JSON,
    ])
    expect(attempts).toBe(2)
    const review = events.find((event) => event.kind === 'review')
    expect(review).toMatchObject({
      kind: 'review',
      stage: 'planning',
      check: 'safety',
      verdict: 'flag',
    })
    expect((review as { reason: string }).reason).toContain('R-01')
    const retry = events.find((event) => event.kind === 'retry')
    // ★ 判据 5 的原话：「失败原因**具体到条款 id**，不是「生成失败」」
    expect((retry as { reason: string }).reason).toContain('R-01')
    // 改过之后那一版是过得去的，所以它发得出来
    expect(events.some((event) => event.kind === 'plan-ready')).toBe(true)
  })

  it('flag 三次都改不动：抛的仍是 schema-validation-failed，但原因里是条款', async () => {
    const dirty = draftWith(0, { body: ['他站在门口，血从窗帘后面渗出来。'] })
    const { error } = await runPlan([dirty, dirty, dirty])
    expect((error as { code: string }).code).toBe('schema-validation-failed')
    expect((error as Error).message).toContain('内容审核没过')
    expect((error as Error).message).toContain('R-01')
  })

  it('★ block：当场拒发、不重试，而且只调了一次模型', async () => {
    const { text, calls } = fakeText([draftWith(1, { body: ['他在厨房里玩火。'] })])
    const { events, emit } = emitter()
    await expect(planStory(INPUT, { text, form: 'solo', emit })).rejects.toMatchObject({
      code: 'review-blocked',
    })
    // ★ 这一条是 `ClauseDisposition` 里 `block` 的**定义**：让模型看着那段内容再改一遍，
    //   本身就是一次多余的接触。`maxAttempts` 是 3，这里必须真的是 1。
    expect(calls()).toBe(1)
    expect(events.some((event) => event.kind === 'retry')).toBe(false)
    expect(events.some((event) => event.kind === 'plan-ready')).toBe(false)
    const review = events.find((event) => event.kind === 'review')
    expect(review).toMatchObject({ verdict: 'block' })
    expect((review as { reason: string }).reason).toContain('R-06')
  })

  it('block 的错误消息与 detail 都指得到条款与页', async () => {
    const { error } = await runPlan([draftWith(1, { body: ['他在厨房里玩火。'] })])
    const failure = error as { code: string; message: string; detail: unknown }
    expect(failure.code).toBe('review-blocked')
    expect(failure.message).toContain('R-06')
    expect(failure.detail).toEqual(['2:R-06'])
  })

  it('干净的一版：一个 review 事件都不发（通过的审核不占格）', async () => {
    const { events, attempts } = await runPlan([CLEAN_JSON])
    expect(attempts).toBe(1)
    expect(events.some((event) => event.kind === 'review')).toBe(false)
  })
})

/* ───────────────── 接线：家长走的那条路（`planBook`）也拦得住 ───────────────── */

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'test-card',
  childId: 'test-child',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸、下颌线软' },
    { slot: 'eyes', value: '深棕圆眼' },
    { slot: 'hair', value: '黑直短发' },
    { slot: 'build', value: '头身比约 1:4' },
    { slot: 'skin', value: '暖黄偏深' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  reference: { path: 'cards/test/ref.png', digest: 'deadbeef0000', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'fake-image', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

const REQUEST: BookRequest = {
  child: {
    childId: 'test-child',
    name: '小乐',
    nameReading: 'xiǎo lè',
    ageBand: '4-6',
    gender: 'girl',
    lookTags: ['短发'],
    interestTags: ['云'],
  },
  card: CARD,
  theme: 'cloud',
  wish: '一朵云变来变去',
  form: 'solo',
  pages: 3,
}

describe('⑥ planBook 那一层（角色卡校验之后、事件工厂之前的那条路）', () => {
  it('越线的一版发不出来，且失败原因是审核给的', async () => {
    const { text } = fakeText([draftWith(0, { imagePrompt: '草地上躺着一具尸体' })])
    const providers = {
      mode: 'offline',
      text,
      image: null,
      vision: null,
      voice: null,
      store: createMemoryStore(),
    } as unknown as ProviderBundle

    const failure = await planBook(REQUEST, { providers }).then(
      () => null,
      (error: unknown) => error as { code: string; message: string },
    )
    // ★ 拦下它的是审核（`R-01`），不是别的什么半路绊住——
    //   所以断言落在**条款 id**上，而不是「反正报错了」
    expect(failure?.message).toContain('R-01')
    expect(failure?.message).toContain('内容审核没过')
  })
})

/* ───────────────── 第二道闸：出图之前（家长改过的那一版也要审） ───────────────── */

describe('⑦ illustrateBook 的审核：拦在第一张图之前', () => {
  it('家长改出来的越线正文：抛 review-blocked，且**一张图都没画**', async () => {
    let imageCalls = 0
    const image: ImageGenerator = {
      id: 'fake-image',
      modelId: 'fake-image',
      supportedRatios: ['1:1'],
      supportsReference: false,
      async generate() {
        imageCalls += 1
        return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', modelId: 'fake-image' }
      },
    }
    const providers = {
      mode: 'offline',
      text: null,
      image,
      vision: null,
      voice: null,
      store: createMemoryStore(),
    } as unknown as ProviderBundle

    // ★ 这一版**不是**模型写的第 1 版：它是家长在故事闸门上改出来的那一版
    //   （盘上 `story.json` 里的字才是要拿去画、拿去念的）。
    //   规划那一道闸看不到它——只留规划那一道，家长手打进去的每个字都绕过了闸门。
    const tree = treeOf([
      { ...(CLEAN_PAGES[0] as NodeDraft), body: ['他一刀刺伤了小鸟。'] },
      ...CLEAN_PAGES.slice(1),
    ])
    const events: EngineEvent[] = []
    let seq = 0
    const onEvent = (event: EngineEvent): void => {
      seq += 1
      events.push({ ...event, seq })
    }

    const failure = await illustrateBook(REQUEST, tree, { providers, onEvent }).then(
      () => null,
      (error: unknown) => error as { code: string; message: string },
    )
    expect(failure?.code).toBe('review-blocked')
    expect(failure?.message).toContain('R-02')
    // ★ 判据要选**只有真做才会不同**的量：出图是这条流水线上唯一真花钱的一步，
    //   而"拦在它之前"这件事的唯一证据就是**调用次数为 0**。
    //   只断言"抛了错"的话，把闸门挪到画完之后也照样绿。
    expect(imageCalls).toBe(0)
    expect(events.find((event) => event.kind === 'review')).toMatchObject({
      stage: 'auditing',
      check: 'safety',
      // ★ `flag` 不是 `block`，而这一道闸**照样拒发**：`R-02` 的处置是"重写一版"，
      //   但在这里没有那条路——`illustrateBook` 不重做规划（那会把家长改的东西丢掉），
      //   所以这一道上两种处置的下一步都是"退回去改那一份故事"。
      //   断言写成 `flag` 是为了把这个差别钉住：把它改成 `block` 会红，
      //   而那时该做的是去看处置表，不是把断言顺手改掉。
      verdict: 'flag',
    })
  })
})

/* ───────── 家长那句自由输入过闸（2026-10-19，`.scratch/safety` 工单 02）───────── */

describe('⑧ 家长那句自由输入：同一份词表，但处置只有一种', () => {
  it('命中就给得出条款 id、类别与**是哪一格**', () => {
    const review = reviewInput([
      { label: '主题', text: '小狗死掉的故事' },
      { label: '改稿要求', text: '让他别玩火' },
    ])
    expect(review.verdict).toBe('block')
    expect(review.problems.map((problem) => [problem.field, problem.clauseId])).toEqual([
      ['主题', 'R-03'],
      ['改稿要求', 'R-06'],
    ])
    expect(reviewInputText(review.problems[0]!)).toBe('主题：死亡（R-03）——出现了「死」')
  })

  it('空的那几格不跑（与 `reviewText` 同一条），空白不算命中', () => {
    expect(reviewInput([{ label: '主题', text: '   ' }]).verdict).toBe('pass')
    expect(reviewInput([{ label: '主题', text: 'cloud' }]).verdict).toBe('pass')
    expect(reviewInput([]).verdict).toBe('pass')
  })

  it('★ 直接走 `planStory`：拒发、**一次模型调用都不发**、事件里带条款 id', async () => {
    const { text, calls } = fakeText([CLEAN_JSON])
    const { events, emit } = emitter()
    await expect(
      planStory({ ...INPUT, theme: '小狗死掉的故事' }, { text, form: 'solo', emit }),
    ).rejects.toMatchObject({ code: 'review-blocked' })

    // ★ 这条是这一档**全部价值的一半**：拦在模型之前，那段内容根本没接触过模型。
    //   只断言"抛了错"的话，把闸门挪到第一次调用之后也照样绿
    expect(calls()).toBe(0)
    const review = events.find((event) => event.kind === 'review')
    // ★ `flag` 而不是 `block`：`R-03` 的处置是"重写一版"，而这道闸上**两种处置的
    //   下一步是同一件事**（都是拒发）——这是别人的话，没有"我们替你重写"这条路。
    //   事件里的 `verdict` 仍然如实报是哪一种，让界面说得清。
    expect(review).toMatchObject({ stage: 'planning', check: 'safety', verdict: 'flag' })
    expect((review as { reason: string }).reason).toContain('R-03')
    // 一个字都没开始编，所以没有 plan-ready
    expect(events.some((event) => event.kind === 'plan-ready')).toBe(false)
  })

  it('★ 命中 `block` 那一类时事件如实报 block（处置一样是拒发，但话说得不一样）', async () => {
    const { text, calls } = fakeText([CLEAN_JSON])
    const { events, emit } = emitter()
    await expect(
      planStory({ ...INPUT, wish: '让他知道自杀有多可怕' }, { text, form: 'solo', emit }),
    ).rejects.toMatchObject({ code: 'review-blocked' })
    expect(calls()).toBe(0)
    expect(events.find((event) => event.kind === 'review')).toMatchObject({ verdict: 'block' })
  })

  it('★ 三道自由文本都过闸：主题 / 那句话 / 改稿要求', async () => {
    for (const [where, patch] of [
      ['主题', { theme: '小猫流血了' }],
      ['那句话', { wish: '让他知道自杀有多可怕' }],
      ['改稿要求', { reviseNote: '加一段怪兽狰狞地尖叫' }],
    ] as const) {
      const { text, calls } = fakeText([CLEAN_JSON])
      const { emit } = emitter()
      await expect(
        planStory({ ...INPUT, ...patch }, { text, form: 'solo', emit }),
      ).rejects.toMatchObject({ code: 'review-blocked' })
      expect({ where, calls: calls() }).toEqual({ where, calls: 0 })
    }
  })

  it('反例：12 个预设主题名与常见那句"希望孩子得到"，一条都不拦', async () => {
    for (const theme of THEME_LABELS) {
      expect({ theme, verdict: reviewInput([{ label: '主题', text: theme }]).verdict }).toEqual({
        theme,
        verdict: 'pass',
      })
    }
    for (const wish of [
      '他怕黑，想让他胆子大一点',
      '刚上幼儿园，想让他知道妈妈会回来',
      '学骑自行车摔了一跤，想让他别怕',
      '爷爷住院了，他总问什么时候回来',
      '妹妹刚出生，他有点不高兴',
    ]) {
      expect({
        wish,
        verdict: reviewInput([{ label: '你想让孩子得到的', text: wish }]).verdict,
      }).toEqual({ wish, verdict: 'pass' })
    }
  })
})
