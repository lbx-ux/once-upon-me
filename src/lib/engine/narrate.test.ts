/**
 * narrate.test.ts —— 逐页配音的两条行为
 *
 * 1. **去重键是 `(voiceId, textHash)`**（`domain.ts` 的 Narration 注释早就定死了）。
 *    共读版的故事树里主干页会被多个分支共用，同一段正文合成两次是白花钱。
 *    复用必须是**同一份文件**，不是"再合成一次但标个 reused"——所以这里同时断言
 *    合成次数与 asset 路径。
 * 2. **一页配不上音不影响别的页，但必须留下痕迹**。抛出的错要收成 `{pageNo, message}`
 *    并补一条**非致命**的 error 事件；书照样装订。
 *
 * 另外锁一条很容易被"顺手改好"的事：正文是 `body.join('')`，**不加空格**。
 * 实测那句两句相连的正文合成出来约 2.5 秒，改成空格会插进一个没量过的停顿
 * （narrate.ts 文件头第 2 条）。
 */

import { describe, expect, it } from 'vitest'

import { narrateAll, narrateNode, narrationTextOf, nextTakeNo } from './narrate.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { EngineEventPayload } from './events.ts'
import type { StoryNode } from './domain.ts'
import type { VoiceSynthesizer } from './providers/types.ts'

function node(pageNo: number, body: string[]): StoryNode {
  return {
    nodeId: `n${pageNo}`,
    pageNo,
    scene: `第 ${pageNo} 页`,
    body,
    imagePrompt: 'x',
    mood: 'calm',
    next: [],
    pathFromRoot: [`n${pageNo}`],
  }
}

/** 只会吐固定字节的假 TTS，记下每次合成了什么文本；`failOnText` 命中就抛 */
function fakeVoice(failOnText?: string) {
  const texts: string[] = []
  const voice: VoiceSynthesizer = {
    id: 'fake-voice',
    modelId: 'fake-voice',
    async clone() {
      return { voiceId: 'v-fake' }
    },
    async synthesize(req) {
      texts.push(req.text)
      if (failOnText !== undefined && req.text === failOnText) {
        throw new Error('上游 500')
      }
      return { bytes: new Uint8Array([1, 2, 3, 4]), mime: 'audio/mpeg' }
    },
    async release() {
      return { released: true }
    },
  }
  return { voice, texts }
}

async function run(nodes: StoryNode[], voice: VoiceSynthesizer) {
  const events: EngineEventPayload[] = []
  const store = await createMemoryStore()
  const result = await narrateAll(nodes, {
    voice,
    voiceId: 'longjielidou_v3.6',
    store,
    bookId: 'book-1',
    emit: (payload) => events.push(payload),
  })
  return { result, events, store }
}

describe('narrateAll · 去重', () => {
  it('★ 同一段正文只合成一次，第二页复用同一个 asset 路径并标 reused', async () => {
    const { voice, texts } = fakeVoice()
    const { result, events } = await run(
      [node(1, ['天黑了。']), node(2, ['天黑了。']), node(3, ['天亮了。'])],
      voice,
    )

    expect(texts).toEqual(['天黑了。', '天亮了。'])
    expect(result.narrations).toHaveLength(3)
    expect(result.errors).toEqual([])

    const [first, second, third] = result.narrations
    expect(second?.asset.path).toBe(first?.asset.path)
    expect(second?.textHash).toBe(first?.textHash)
    expect(third?.asset.path).not.toBe(first?.asset.path)

    const narrationEvents = events.filter((e) => e.kind === 'narration')
    expect(narrationEvents.map((e) => (e.kind === 'narration' ? e.reused : null))).toEqual([
      false,
      true,
      false,
    ])
  })

  it('同一段正文换个音色要重新合成：去重键里带 voiceId', async () => {
    const { voice, texts } = fakeVoice()
    const nodes = [node(1, ['一样的句子。'])]
    await run(nodes, voice)
    const events: EngineEventPayload[] = []
    const store = await createMemoryStore()
    await narrateAll(nodes, {
      voice,
      voiceId: 'longpaopao_v3.6',
      store,
      bookId: 'book-1',
      emit: (payload) => events.push(payload),
    })
    expect(texts).toEqual(['一样的句子。', '一样的句子。'])
  })

  it('空正文的页跳过：不合成、不报错、也没有 narration', async () => {
    const { voice, texts } = fakeVoice()
    const { result } = await run([node(1, []), node(2, ['   ']), node(3, ['有字。'])], voice)
    expect(texts).toEqual(['有字。'])
    expect(result.narrations.map((n) => n.pageNo)).toEqual([3])
    expect(result.errors).toEqual([])
  })
})

describe('narrateAll · 一页坏了不拖垮整本', () => {
  it('★ 第 2 页抛错 → 1、3 页照配有音，错误收进 errors 且事件是 fatal: false', async () => {
    const { voice } = fakeVoice('坏掉的第二页。')
    const { result, events } = await run(
      [node(1, ['第一页。']), node(2, ['坏掉的第二页。']), node(3, ['第三页。'])],
      voice,
    )

    expect(result.narrations.map((n) => n.pageNo)).toEqual([1, 3])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.pageNo).toBe(2)
    expect(result.errors[0]?.message).toContain('上游 500')

    const errors = events.filter((e) => e.kind === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ stage: 'narrating', pageNo: 2, fatal: false })
  })
})

describe('narrationTextOf · 正文怎么拼', () => {
  it("join('')，不加空格（实测 2.5 秒那个数是按这个拼法量的）", () => {
    expect(narrationTextOf(node(1, ['哗啦啦，大雨落下来。', '地上变成亮晶晶的河。']))).toBe(
      '哗啦啦，大雨落下来。地上变成亮晶晶的河。',
    )
  })
})

/**
 * ★ 单页重配（工单 01 §五）。
 *
 * 两件事是新的，各自对应一种"只有真跑一本书才会发现"的坏法：
 * 1. **带页码的 stage**：原来整本只发不带页码的那一对，于是没有任何东西说得清
 *    "这一页正在配音"——`frames.ts` 的 `Frame.busy = 'voicing'` 就是从它推的。
 * 2. **`takeNo`**：重配落一份**新文件**。从 1 重来的话会把上一版录音覆盖掉，
 *    而"失败的产物不许被覆盖"是这条流水线写明的纪律。
 */
describe('narrateNode · 单页重配', () => {
  it('★ 合成前后各发一条**带页码**的 stage（这样才说得出"这一页正在配音"）', async () => {
    const { voice } = fakeVoice()
    const events: EngineEventPayload[] = []
    const store = await createMemoryStore()
    await narrateNode(node(4, ['月亮落在屋顶上。']), {
      voice,
      voiceId: 'v1',
      store,
      bookId: 'book-1',
      emit: (payload) => events.push(payload),
    })
    expect(events.filter((e) => e.kind === 'stage').map((e) => ({ ...e }))).toEqual([
      { kind: 'stage', stage: 'narrating', phase: 'begin', pageNo: 4 },
      { kind: 'stage', stage: 'narrating', phase: 'end', pageNo: 4 },
    ])
  })

  it('★ 合成失败时收尾那条也照发（否则那一格永远停在"正在配音"上转）', async () => {
    const { voice } = fakeVoice('炸了。')
    const events: EngineEventPayload[] = []
    const store = await createMemoryStore()
    await expect(
      narrateNode(node(1, ['炸了。']), {
        voice,
        voiceId: 'v1',
        store,
        bookId: 'book-1',
        emit: (payload) => events.push(payload),
      }),
    ).rejects.toThrow('上游 500')
    expect(events.at(-1)).toMatchObject({ kind: 'stage', phase: 'end', pageNo: 1 })
  })

  it('★ takeNo 落的是另一份文件，旧录音不被覆盖', async () => {
    const { voice } = fakeVoice()
    const store = await createMemoryStore()
    const first = await narrateNode(node(2, ['天亮了。']), {
      voice,
      voiceId: 'v1',
      store,
      bookId: 'book-1',
      emit: () => undefined,
    })
    const second = await narrateNode(node(2, ['天亮了。']), {
      voice,
      voiceId: 'v1',
      store,
      bookId: 'book-1',
      takeNo: nextTakeNo(first.narration.asset.path),
      emit: () => undefined,
    })
    expect(first.narration.asset.path).toBe('books/book-1/page-2-a1.mp3')
    expect(second.narration.asset.path).toBe('books/book-1/page-2-a2.mp3')
    // 两份都在盘上：旧的那份没有因为重配而消失
    expect(await store.read(first.narration.asset.path)).not.toBeNull()
  })

  it('单页重配**不跨页去重**：用户点的是"这一页"，改的就只能是这一页', async () => {
    // 与 `narrateAll` 的规则 1 相反，这是刻意的：共读版的主干页会共用同一份录音，
    // 按 voiceId:textHash 去重会把别的页一起改掉
    const { voice, texts } = fakeVoice()
    const store = await createMemoryStore()
    await narrateNode(node(1, ['同一句。']), {
      voice,
      voiceId: 'v1',
      store,
      bookId: 'book-1',
      emit: () => undefined,
    })
    await narrateNode(node(2, ['同一句。']), {
      voice,
      voiceId: 'v1',
      store,
      bookId: 'book-1',
      emit: () => undefined,
    })
    expect(texts).toHaveLength(2)
  })
})

describe('nextTakeNo', () => {
  it('认得出第几版；认不出来就从 1 起', () => {
    expect(nextTakeNo('books/b/page-7-a1.mp3')).toBe(2)
    expect(nextTakeNo('books/b/page-7-a12.wav')).toBe(13)
    expect(nextTakeNo(undefined)).toBe(1)
    // 这个名字不是我们这一套（手放进去的、或别的来源）——不猜，从 1 起
    expect(nextTakeNo('books/b/narration.mp3')).toBe(1)
  })
})
