/**
 * illustrate.test.ts —— 一致性比对**调用失败**时的行为
 *
 * 这一条是实测踩出来的，不是推演出来的（`node scripts/engine-run.mts --mode=live
 * --pages=5`，2026-10-13）：
 *
 * - 5 页全部出图，磁盘上 8 张 PNG（含重画），钱都花了；
 * - 比对模型在其中 3 页上回 504 / 网络错；
 * - 书里**只剩 2 页**，汇总行还写着"2/5 页有图"。
 *
 * 成因是 `opts.vision.compare()` 直接 await：异常冒到 `illustrateAll` 的 catch，
 * 于是这一页连同**已经付过钱的图**一起从书里消失。
 * 而 `ConsistencyResult.verdict` 的注释本来就写明 `unavailable` 覆盖
 * "视觉模型未配置**或调用失败**"——代码没做到注释里写的事。
 *
 * 这里锁死三件事：**不抛、图还在、verdict = unavailable**。
 */

import { describe, expect, it } from 'vitest'

import { illustrateNode } from './illustrate.ts'
import { createMemoryStore } from './providers/stores.ts'
import type { CharacterCard, StoryNode } from './domain.ts'
import type { ImageGenerator, VisionComparator } from './providers/types.ts'

const CARD: CharacterCard = {
  schemaVersion: 1,
  cardId: 'test-card',
  childId: 'test-child',
  revision: 1,
  anchors: [{ slot: 'eyes', value: '深棕圆眼' }],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘', ratio: '1:1' },
  reference: { path: 'cards/test/ref.png', digest: 'deadbeef0000', bytes: 3, mime: 'image/png' },
  provenance: { modelId: 'test-image', promptVersion: 'card@v1', cardRevision: 1, generatedAt: 0 },
  createdAt: 0,
}

const NODE: StoryNode = {
  nodeId: 'n1',
  pageNo: 1,
  scene: '夜里的小船',
  body: ['天黑了。'],
  imagePrompt: '一个小孩站在小船边',
  mood: 'calm',
  next: [],
  pathFromRoot: ['n1'],
}

/** 只会出字节的假出图器。`supportsReference: false` = 这条平台实测的真实状态 */
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

// 去掉 `costCny` 之类的精度差异：只保留本文件断言用得到的形状
type Call = { pageNo: number; attempt: number }

async function run(vision: VisionComparator | null): Promise<{
  result: Awaited<ReturnType<typeof illustrateNode>>
  calls: Call[]
}> {
  const calls: Call[] = []
  const result = await illustrateNode(NODE, {
    image: fakeImage(),
    vision,
    store: createMemoryStore(),
    card: CARD,
    referenceDataUrl: 'data:image/png;base64,AAAA',
    bookId: 'book-test',
    emit: (payload) => {
      if (
        payload.kind === 'illustration' &&
        payload.pageNo !== undefined &&
        payload.attempt !== undefined
      ) {
        calls.push({ pageNo: payload.pageNo, attempt: payload.attempt })
      }
    },
    now: () => 0,
  })
  return { result, calls }
}

describe('illustrateNode · 比对调用失败', () => {
  it('比对抛错时不算这一页失败：不抛、图留着、标 unavailable', async () => {
    const throwing: VisionComparator = {
      id: 'kimi-k2.6',
      modelId: 'kimi-k2.6',
      async compare() {
        throw new Error('/chat/completions 失败 HTTP 504 · （上游超时）')
      },
    }

    const { result, calls } = await run(throwing)

    // 1) 图真的画出来了，而且**记录里指向的是那张图**，不是 missing.bin
    expect(calls).toHaveLength(1)
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.asset.path).not.toContain('missing')

    // 2) 判决是"判不了"，不是"不通过"——两者的处置完全不同
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.consistency?.score).toBeNull()

    // 3) 原因里带上原始错误，排障时才看得出是 504 还是别的
    expect(result.consistency?.reason).toContain('504')

    // 4) 仍然要人看一眼（降级 B 的入口），但不是整页失败
    expect(result.needsHumanReview).toBe(true)

    // 5) **不重画**：没有判据的重画是烧钱抽签（illustrate.ts 文件头第 1 条）
    expect(calls).toHaveLength(1)
  })

  it('比对给不出分（score=null）与抛错走同一条路', async () => {
    const nullScore: VisionComparator = {
      id: 'x',
      modelId: 'x',
      async compare() {
        return { score: null, missed: [], reason: '比对模型没有按 JSON 回答', modelId: 'x' }
      },
    }
    const { result, calls } = await run(nullScore)
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(calls).toHaveLength(1)
  })

  it('未配置比对模型时不重画，且明说这一页没核对过', async () => {
    const { result, calls } = await run(null)
    expect(result.consistency?.verdict).toBe('unavailable')
    expect(result.consistency?.reason).toContain('未配置视觉比对模型')
    expect(calls).toHaveLength(1)
  })
})
