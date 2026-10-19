/**
 * split.test.ts —— 「编故事」与「逐页画」拆开之后，**仍然是同一条流水线**
 *
 * 2026-10-17 的故事闸门把 `runBook` 拆成 `planBook` + `illustrateBook`：界面要在两步
 * 之间把那一版故事摊给家长改，所以两步必须能分开调用。这一组用例盯的**不是**新功能，
 * 而是拆分本身不许改行为——它说的是一句可以被证伪的话：
 *
 * > `runBook(request, deps)` 与 `illustrateBook(request, planBook(request).tree, …)`
 * > 产出**同一串事件、同一本书**。
 *
 * ★ 为什么值得一条用例（而不是"看着两段代码一样"）：脚本、横评、离线跑测走的是
 *   `runBook`，而线上产品走的是拆开的那两个——两条路分家的那天起，
 *   量出来的数就不是线上那件事了（docs/known-tradeoffs.md「测量」那一条的同一个教训）。
 *   分成两段之后有三处**只会悄悄错**的地方，这里逐条盯住：
 *
 *   1. **事件序号接续**。②是另一个调用，`createEventFactory` 从 1 重来的话，
 *      日志里会出现两条 `seq: 1`——而 `seq` 正是重放重建界面状态的依据
 *      （`frames.ts` 的 `deskOf` 只按顺序扫，它不会发现号重复了）。
 *   2. **`stats.elapsedMs` 的口径**（①的机器时间 + ②的机器时间，不含家长看故事的时间）。
 *   3. **`doc` 能原样变成 `tree`**。家长改的是 `doc`（书名 + 每页草稿），画的是 `tree`；
 *      两者对不上的话，家长在屏幕上改的东西与真正画出来的东西就是两份数据，
 *      而屏幕上不会有任何东西提示这件事。
 */

import { describe, expect, it } from 'vitest'

import { buildTree } from './tree.ts'
import { illustrateBook, planBook, runBook, type RunDeps } from './index.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { Book, BookRequest, CharacterCard, EngineEvent } from './index.ts'
import type {
  ImageGenerator,
  ProviderBundle,
  TextGenerator,
  TextResponse,
} from './providers/types.ts'

/* ───────────────────────── 假的三个供应商 ───────────────────────── */

/** 一张 3 页的合法故事表。★ 3 页是 `planDraftCodec` 的下界，不是随手挑的数 */
const STORY = {
  title: '小乐的绿天空',
  nodes: [
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
  ],
}

/** 把这一次收到的 user 提示词记下来——「重写」那一段有没有真的发出去，只有这里能答 */
function fakeText(): { text: TextGenerator; prompts: () => string[] } {
  const prompts: string[] = []
  const respond = (): TextResponse => ({
    text: JSON.stringify(STORY),
    modelId: 'fake-text',
  })
  return {
    text: {
      id: 'fake-text',
      modelId: 'fake-text',
      async complete(req) {
        prompts.push(req.user)
        return respond()
      },
      async stream(req, _budget, onDelta) {
        prompts.push(req.user)
        const response = respond()
        // `streamed: false` 是**离线回放的写法**（见 types.ts 那段），
        // 但这里是假生成器：它确实一次给全，所以也照实报 false
        onDelta({ text: response.text, streamed: false })
        return response
      },
    },
    prompts: () => prompts,
  }
}

function fakeImage(): ImageGenerator {
  return {
    id: 'fake-image',
    modelId: 'fake-image',
    supportedRatios: ['1:1'],
    supportsReference: false,
    async generate() {
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: 'image/png',
        modelId: 'fake-image',
        referenceApplied: false,
        costCny: 0.2,
      }
    },
  }
}

/**
 * 一张**合格**的卡：五条硬锚点一条都不能少（`validateCard` 逐条查，
 * 「缺骨相」这种话不是防御性编程，是建卡那一屏真的会漏掉的字段）。
 */
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
  theme: '会飞的绿天空',
  wish: '想象力的力量',
  form: 'solo',
  pages: 3,
}

/** 一份**能跑完一本书**的依赖：文本是假的，图是假的，比对与配音都不接 */
async function bundle(): Promise<{ providers: ProviderBundle; prompts: () => string[] }> {
  const store = createMemoryStore()
  // 卡上的参考图必须真在 store 里：②第一件事就是读它，读不到直接拒跑
  await store.put({
    path: CARD.reference.path,
    bytes: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
  })
  const { text, prompts } = fakeText()
  return {
    providers: { mode: 'offline', text, image: fakeImage(), vision: null, voice: null, store },
    prompts,
  }
}

const EVENT_SHAPE = (event: { kind: string; seq: number }): string => `${event.seq}:${event.kind}`

/* ───────────────────────── 用例 ───────────────────────── */

describe('流水线拆开之后仍然是同一条', () => {
  it('runBook 与 planBook + illustrateBook 产出同一串事件、同一本书', async () => {
    const first = await bundle()
    const firstEvents: EngineEvent[] = []
    const oneGo: Book = await runBook(REQUEST, {
      providers: first.providers,
      now: () => 0,
      onEvent: (event) => firstEvents.push(event),
    })

    const second = await bundle()
    const secondEvents: EngineEvent[] = []
    const deps: RunDeps = {
      providers: second.providers,
      now: () => 0,
      onEvent: (event) => secondEvents.push(event),
    }
    const plan = await planBook(REQUEST, deps)
    const split = await illustrateBook(REQUEST, plan.tree, {
      ...deps,
      startSeq: plan.lastSeq,
      planMs: plan.elapsedMs,
      createdAt: 0,
    })

    expect(secondEvents.map(EVENT_SHAPE)).toEqual(firstEvents.map(EVENT_SHAPE))
    // ★ 书本身逐字段相等：`stats` 一起比，因为 `elapsedMs` 的口径正是这条用例要守的东西
    expect(split).toEqual(oneGo)
  })

  it('①②的序号是一条线：拆开之后不会出现两条 seq: 1', async () => {
    const { providers } = await bundle()
    const events: EngineEvent[] = []
    const deps: RunDeps = { providers, now: () => 0, onEvent: (event) => events.push(event) }

    const plan = await planBook(REQUEST, deps)
    /** ①自己发了多少条。`startSeq` 从 0 起，所以最大的号就是条数 */
    const planned = events.length
    expect(plan.lastSeq).toBe(planned)

    await illustrateBook(REQUEST, plan.tree, { ...deps, startSeq: plan.lastSeq })
    const seqs = events.map((event) => event.seq)

    // 没有重号，也没有跳号
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(seqs).toEqual(seqs.map((_, index) => index + 1))
    // ②的第一条紧跟着①的最后一条（差一个就说明中间漏了或多算了一条）
    expect(seqs[planned]).toBe(plan.lastSeq + 1)
  })

  it('①的 doc 原样能长回同一棵树（家长改的就是这一份）', async () => {
    const { providers } = await bundle()
    const plan = await planBook(REQUEST, { providers, now: () => 0 })

    const rebuilt = buildTree(plan.tree.form, plan.doc.title, plan.doc.nodes)
    expect(rebuilt.ok).toBe(true)
    // 逐字段相等：`doc` 是家长看到、能改的那一份，`tree` 是真拿去画的那一棵
    expect(rebuilt.tree).toEqual(plan.tree)
  })

  it('「让 AI 重写一版」那句话真的进了发出去的提示词', async () => {
    const plain = await bundle()
    await planBook(REQUEST, { providers: plain.providers, now: () => 0 })
    expect(plain.prompts()[0]).not.toContain('结局改成她带着全班一起飞')

    const revised = await bundle()
    await planBook(REQUEST, {
      providers: revised.providers,
      now: () => 0,
      reviseNote: '结局改成她带着全班一起飞',
    })
    const user = revised.prompts()[0] ?? ''
    expect(user).toContain('结局改成她带着全班一起飞')
    // ★ 「重写整篇」这三个字不许省：省了模型会在原稿上打补丁，
    //   而那正是家长拿新旧两版对着看时第一个会发现的东西
    expect(user).toContain('重写整篇')
  })

  it('①跑完时盘上还没有这一本：闸门的意义就在这里', async () => {
    const { providers } = await bundle()
    const plan = await planBook(REQUEST, { providers, now: () => 0 })

    // 编完故事时磁盘上不该有任何一页图，也不该有清单——
    // 有的话说明"编故事"这一个动作偷偷把②也做了（那就等于闸门不存在）
    const files = await providers.store.list('books/')
    expect(files.filter((path) => path.endsWith('book.json'))).toEqual([])
    expect(files.filter((path) => /page-\d/.test(path))).toEqual([])
    // 而故事已经在了：它就是闸门要摊给家长的那一份
    expect(plan.doc.title).toBe('小乐的绿天空')
    expect(plan.doc.nodes).toHaveLength(3)
  })
})
