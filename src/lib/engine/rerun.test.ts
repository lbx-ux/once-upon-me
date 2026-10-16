/**
 * rerun.test.ts —— 单页重做那两个入口（工单 01 的引擎面 + 工单 08 的两个新参数）
 *
 * 这一组盯的是"**只有真跑一本书才会撞上**"的那几条：
 *
 * 1. **重画时那句补充真的进了提示词**，而且**位置在页级描述之后**——
 *    接在最后（负极清单后面）的话它会与那一长串"避免出现…"抢注意力，
 *    而它说的是"上一张哪里错了"，比那三行通用约束更要紧。
 * 2. **重配改了正文，书里那一页的字也跟着改**。这是用户看不到的一条：
 *    他只看到"这段录音念的是什么"，而正文是**阅读器上那几段字**（同一个字段）。
 * 3. **删空的正文要当场拒**，不是等 TTS 那边回一段静音。
 * 4. **同一页只留一条**（替换不是追加）：写成追加的话，20 页的书重画 3 页会变成 23 页
 *    ——`frames.ts` 判据 1 为此写过一次，这里是同一个教训的引擎面。
 */

import { describe, expect, it } from 'vitest'

import { rerunNarration, rerunPage } from './index.ts'
import type { Book, CharacterCard, StoryNode } from './domain.ts'
import type {
  AssetStore,
  ImageGenerator,
  ProviderBundle,
  VoiceSynthesizer,
} from './providers/types.ts'
import { createMemoryStore } from './providers/stores.ts'

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'c1',
  childId: 'kid-1',
  revision: 1,
  anchors: [{ slot: 'eyes', value: '深棕圆眼' }],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  // ★ 参考图必须**读得到**：`rerunPage` 读不到就拒绝重画（与整本那条同一个判据）
  reference: { path: 'cards/c1/ref.png', digest: 'beef', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'm', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

function node(pageNo: number, body: string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: `场景 ${pageNo}`,
    body,
    imagePrompt: `画面 ${pageNo}`,
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

function book(parts: Partial<Book> = {}): Book {
  return {
    bookId: 'b1',
    cardId: 'c1',
    cardRevision: 1,
    form: 'solo',
    tree: {
      form: 'solo',
      title: 'T',
      rootId: 'n1',
      nodes: [node(1, ['第一页的字。']), node(2, ['第二页的字。'])],
    },
    illustrations: [
      {
        pageNo: 1,
        attempt: 1,
        asset: { path: 'books/b1/page-1-a1.png', mime: 'image/png', digest: 'd', bytes: 1 },
        provenance: {
          modelId: 'm',
          promptVersion: 'image-page@v1',
          cardRevision: 1,
          generatedAt: 0,
        },
        needsHumanReview: false,
        costCny: 0.2,
      },
    ],
    errors: [],
    narrations: [
      {
        pageNo: 1,
        voiceId: 'v-old',
        textHash: 'h',
        asset: { path: 'books/b1/page-1-a1.mp3', mime: 'audio/mpeg', digest: 'd', bytes: 1 },
      },
    ],
    createdAt: 0,
    stats: {
      elapsedMs: 1000,
      imageCalls: 3,
      firstPassCount: 1,
      redrawCount: 0,
      totalCostCny: 0.6,
      nodesPlanned: 2,
      nodesGenerated: 2,
    },
    ...parts,
  } as Book
}

/** 记下每一次出图的完整提示词 */
function capturingImage() {
  const prompts: string[] = []
  const image: ImageGenerator = {
    id: 'fake-image',
    modelId: 'fake-image',
    supportedRatios: ['3:2'],
    supportsReference: false,
    async generate(req) {
      prompts.push(req.prompt)
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: 'image/png',
        modelId: 'fake-image',
        referenceApplied: false,
        costCny: 0.2,
      }
    },
  }
  return { image, prompts }
}

/** 记下每一次合成了什么文本 */
function capturingVoice() {
  const texts: string[] = []
  const voice: VoiceSynthesizer = {
    id: 'fake-voice',
    modelId: 'fake-voice',
    async clone() {
      return { voiceId: 'v-clone' }
    },
    async synthesize(req) {
      texts.push(req.text)
      return { bytes: new Uint8Array([1, 2]), mime: 'audio/mpeg' }
    },
    async release() {
      return { released: true }
    },
  }
  return { voice, texts }
}

async function bundle(): Promise<ProviderBundle & { store: AssetStore }> {
  const store = createMemoryStore()
  // 参考图要在盘上——`rerunPage` 读不到它就直接拒绝（"没有参考图就没有锁脸与比对"）
  await store.put({
    path: CARD.reference.path,
    bytes: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
  })
  const { image, prompts } = capturingImage()
  const { voice, texts } = capturingVoice()
  return {
    mode: 'offline',
    // rerunPage / rerunNarration 都不碰文本能力（那是规划那一步的事）
    text: { id: 'none', modelId: 'none' } as unknown as ProviderBundle['text'],
    image,
    vision: null,
    voice,
    store,
    // 测试自己用的两个（TS 的结构类型允许多做几个字段在对象字面量里……但不允许——
    // 所以它们挂在下面这个断言上，见 `captured`)
    ...({ prompts, texts } as object),
  } as ProviderBundle & { store: AssetStore }
}

describe('rerunPage · 重画一页', () => {
  it('★ 家长写的那句补充进了提示词，而且排在「情绪」之后、构图之前', async () => {
    const providers = await bundle()
    const prompts = (providers as unknown as { prompts: string[] }).prompts
    await rerunPage(
      { book: book(), card: CARD, pageNo: 1, fixNote: '头发比标准像长' },
      { providers, now: () => 0 },
    )
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('★ 这一版要改掉上一版的问题：头发比标准像长')
    expect(prompt.indexOf('★ 这一版要改掉')).toBeGreaterThan(prompt.indexOf('情绪：'))
    expect(prompt.indexOf('★ 这一版要改掉')).toBeLessThan(prompt.indexOf('构图：'))
  })

  it('不写补充时提示词里没有那一块', async () => {
    const providers = await bundle()
    const prompts = (providers as unknown as { prompts: string[] }).prompts
    await rerunPage({ book: book(), card: CARD, pageNo: 1 }, { providers, now: () => 0 })
    expect(prompts[0]).not.toContain('要改掉上一版的问题')
  })

  it('★ 同一页只留一条（替换不是追加），而且 attempt 接着数', async () => {
    const providers = await bundle()
    const after = await rerunPage(
      { book: book(), card: CARD, pageNo: 1 },
      { providers, now: () => 0 },
    )
    expect(after.illustrations).toHaveLength(1)
    expect(after.illustrations[0]?.attempt).toBe(2)
    // 文件名也跟着往后走（`attemptBase`）——否则会把上一版那张覆盖掉
    expect(after.illustrations[0]?.asset.path).toBe('books/b1/page-1-a2.png')
  })

  it('★ 这一页从 errors 里摘掉：它以前"没做出来"，现在做出来了', async () => {
    const providers = await bundle()
    const failed = book({ errors: [{ pageNo: 1, message: '这一页没做出来' }] })
    const after = await rerunPage(
      { book: failed, card: CARD, pageNo: 1 },
      { providers, now: () => 0 },
    )
    expect(after.errors).toEqual([])
  })

  it('★ stats 只累加：首次通过率那两个数**不重算**（那是模型的成绩，不是人的干预）', async () => {
    const providers = await bundle()
    const after = await rerunPage(
      { book: book(), card: CARD, pageNo: 1 },
      { providers, now: () => 0 },
    )
    expect(after.stats.imageCalls).toBe(4) // 3 + 这一次的 1
    expect(after.stats.firstPassCount).toBe(1)
    expect(after.stats.redrawCount).toBe(0)
    expect(after.stats.totalCostCny).toBeCloseTo(0.8)
  })

  it('页码越界 → page-not-found（不是"第 0 页"那种静默的错）', async () => {
    const providers = await bundle()
    await expect(
      rerunPage({ book: book(), card: CARD, pageNo: 9 }, { providers, now: () => 0 }),
    ).rejects.toMatchObject({ code: 'page-not-found' })
  })
})

describe('rerunNarration · 重配一页', () => {
  it('★ 改过的正文写回书里那一页（阅读器上那几段字跟着变）', async () => {
    const providers = await bundle()
    const after = await rerunNarration(
      { book: book(), card: CARD, pageNo: 1, body: ['改过的第一句。', '还有第二句。'] },
      { providers, now: () => 0 },
    )
    expect(after.tree.nodes[0]?.body).toEqual(['改过的第一句。', '还有第二句。'])
    // 别的页一个字没动
    expect(after.tree.nodes[1]?.body).toEqual(['第二页的字。'])
    // 而合成用的是改过的那段
    expect((providers as unknown as { texts: string[] }).texts[0]).toBe(
      '改过的第一句。还有第二句。',
    )
  })

  it('不带 body 就是照原来那段重录一遍，正文不动', async () => {
    const providers = await bundle()
    const before = book()
    const after = await rerunNarration(
      { book: before, card: CARD, pageNo: 1 },
      { providers, now: () => 0 },
    )
    expect(after.tree.nodes[0]?.body).toEqual(['第一页的字。'])
    expect((providers as unknown as { texts: string[] }).texts[0]).toBe('第一页的字。')
  })

  it('★ 正文被删空 → 当场拒，不去要一段空白音频', async () => {
    const providers = await bundle()
    await expect(
      rerunNarration(
        { book: book(), card: CARD, pageNo: 1, body: ['  ', ''] },
        { providers, now: () => 0 },
      ),
    ).rejects.toMatchObject({ code: 'invalid-request' })
    // 一次合成都没发生
    expect((providers as unknown as { texts: string[] }).texts).toEqual([])
  })

  it('★ 重配落一份**新文件**（旧录音留着），同一页仍然只有一条', async () => {
    const providers = await bundle()
    const after = await rerunNarration(
      { book: book(), card: CARD, pageNo: 1 },
      { providers, now: () => 0 },
    )
    expect(after.narrations).toHaveLength(1)
    expect(after.narrations[0]?.asset.path).toBe('books/b1/page-1-a2.mp3')
  })

  it('★ 换音色时 `Book.voiceId` 跟着走（否则清单上写 A、每一页都是 B）', async () => {
    const providers = await bundle()
    const after = await rerunNarration(
      { book: book(), card: CARD, pageNo: 1, voiceId: 'v-new' },
      { providers, now: () => 0 },
    )
    expect(after.voiceId).toBe('v-new')
    expect(after.narrations[0]?.voiceId).toBe('v-new')
  })

  it('没配配音能力时给出可读的错（不是静默不动）', async () => {
    const providers = await bundle()
    await expect(
      rerunNarration(
        { book: book(), card: CARD, pageNo: 1 },
        { providers: { ...providers, voice: null }, now: () => 0 },
      ),
    ).rejects.toMatchObject({ code: 'provider-not-configured' })
  })
})
