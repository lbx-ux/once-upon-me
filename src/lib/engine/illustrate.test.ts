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
import type { AssetStore, ImageGenerator, VisionComparator } from './providers/types.ts'

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
type ErrorEvent = { pageNo?: number; message: string; fatal: boolean }

/**
 * 可控的假出图器：第 n 次调用按 `plan[n - 1]` 行事。
 * `'ok'` = 正常出一张图；给 `Error` 就在那一次抛。
 */
function scriptedImage(plan: ('ok' | Error)[]): { image: ImageGenerator; calls: () => number } {
  let seen = 0
  const base = fakeImage()
  const image: ImageGenerator = {
    ...base,
    async generate() {
      const step = plan[seen]
      seen += 1
      if (step instanceof Error) throw step
      if (step === undefined) throw new Error(`剧本只写了 ${plan.length} 次，这是第 ${seen} 次`)
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: 'image/png',
        modelId: 'fake-image',
        referenceApplied: false,
        costCny: 0.2,
      }
    },
  }
  return { image, calls: () => seen }
}

async function run(
  vision: VisionComparator | null,
  extra: { image?: ImageGenerator; store?: AssetStore } = {},
): Promise<{
  result: Awaited<ReturnType<typeof illustrateNode>>
  calls: Call[]
  errors: ErrorEvent[]
}> {
  const calls: Call[] = []
  const errors: ErrorEvent[] = []
  const result = await illustrateNode(NODE, {
    image: extra.image ?? fakeImage(),
    vision,
    store: extra.store ?? createMemoryStore(),
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
      if (payload.kind === 'error') {
        errors.push({
          ...(payload.pageNo === undefined ? {} : { pageNo: payload.pageNo }),
          message: payload.message,
          fatal: payload.fatal,
        })
      }
    },
    now: () => 0,
  })
  return { result, calls, errors }
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

/**
 * ★ 这一组是 2026-10-16 补的，对着一次**真跑出来的**事故写：
 *   `.out/web/books/xiaolu-r1-ee69012def18` 第 6 页。
 *
 *   第 1 次画好了（`page-6-a1.png`，1536×1024、3.0 MB 就在磁盘上），比对没过 →
 *   重画 → 第 2 次在**下图那一跳**撞上 `ECONNRESET` → 整页变成 `errors` 里的一条，
 *   那张已经付过钱的图从书里消失，阅读器上写着"这一页没做出来"——**假话**。
 *
 *   成因与上面那一组**完全同源**（异常冒到 `illustrateAll` 的 catch），
 *   只是当时只修了比对那一跳，真正出图与下图那两跳没修。
 *   所以判据也同形：**不抛、图还在、并且说清"重画没跑成"**。
 */
describe('illustrateNode · 出图/落盘失败时不许丢掉已经画好的图', () => {
  /** 按剧本给分的比对器：`0.3` = 不像，`null` = 判不了 */
  function scriptedVision(scores: (number | null)[]): VisionComparator {
    let seen = 0
    return {
      id: 'fake-vision',
      modelId: 'fake-vision',
      async compare() {
        const score = scores[seen] ?? null
        seen += 1
        return { score, missed: [], reason: '头身比不对', modelId: 'fake-vision' }
      },
    }
  }

  /** 真实那条报错原文（`providers/http.ts` 的 `fetchBytes` 拼出来的形状） */
  const ECONNRESET = new Error(
    '下载媒体网络错误：TypeError: terminated · ECONNRESET — 连接被对面掐断（可能已经处理过了）（主机 tokenrhythm-prod-backup-oss.oss-cn-beijing.aliyuncs.com）',
  )

  it('★ 重画抛网络错时，书上留的是**第 1 次那张图**，不是 missing.bin', async () => {
    const { image, calls: imageCalls } = scriptedImage(['ok', ECONNRESET])
    const { result, calls, errors } = await run(scriptedVision([0.3]), { image })

    // 1) 图还在，而且指向的是**已经画完的那一次**，不是空白占位
    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.asset.path).not.toContain('missing')
    expect(result.attempt).toBe(1)

    // 2) 判决照旧是"不像"（那是第 1 次的判决，不该被后面那次失败改写成别的）
    expect(result.consistency?.verdict).toBe('fail')
    expect(result.needsHumanReview).toBe(true)

    // 3) ★ 但书里要写清**为什么停在第 1 次**：原始那句"哪一撮头发不对"一个字不丢，
    //    后面续上停手的原因。没有这一句，`verdict:'fail' + attempt:1` 看不出
    //    "后面还画过、只是被打断了"，而"重画几次"是 r_redraw 的数据源
    expect(result.consistency?.reason).toContain('头身比不对')
    expect(result.consistency?.reason).toContain('重画没跑成')
    expect(result.consistency?.reason).toContain('ECONNRESET')
    expect(result.consistency?.reason).toContain('不是"没做出来"')

    // 4) 也要出事件（过程日志里看得见），并且**不许是 fatal**——
    //    它不是整本书失败，也不是这一页没有图
    expect(errors).toHaveLength(1)
    expect(errors[0]?.fatal).toBe(false)
    expect(errors[0]?.pageNo).toBe(1)
    expect(errors[0]?.message).toContain('重画没跑成')

    // 5) 真的画过两次（第 2 次是失败的那次），但**只有一次成功产出**
    expect(imageCalls()).toBe(2)
    expect(calls).toHaveLength(1)

    // 6) 产出失败后不再往下一次尝试：不是漏了，是"再来一次就是重新付一次钱"
    //    （理由写在 `produceFailed` 的注释里）
    expect(imageCalls()).toBe(2)
  })

  it('落盘那一步失败与出图那一步失败走同一条路', async () => {
    const base = createMemoryStore()
    let puts = 0
    const flaky: AssetStore = {
      ...base,
      async put(entry) {
        puts += 1
        if (puts >= 2) throw new Error('落盘失败：磁盘满了（ENOSPC）')
        return base.put(entry)
      },
    }
    const { result, errors } = await run(scriptedVision([0.3]), {
      image: scriptedImage(['ok', 'ok']).image,
      store: flaky,
    })

    expect(result.asset.path).toBe('books/book-test/page-1-a1.png')
    expect(result.consistency?.reason).toContain('落盘失败')
    expect(errors).toHaveLength(1)
  })

  it('★ 第 1 次就没成时照旧抛出去——那一页**确实**没有图，这才该进 errors', async () => {
    // 这一条与上面两条是**一对**：修"丢掉已有的图"不等于"什么错都不抛了"。
    // 分界线只有一个：手上有没有一张画完的图。
    const { image } = scriptedImage([ECONNRESET])
    await expect(run(scriptedVision([0.3]), { image })).rejects.toThrow(/ECONNRESET/)
  })

  it('落盘失败也不例外：第 1 次就没落成 → 抛（不能拿半张图充数）', async () => {
    const broken: AssetStore = {
      ...createMemoryStore(),
      async put() {
        throw new Error('落盘失败：磁盘满了（ENOSPC）')
      },
    }
    await expect(run(scriptedVision([0.3]), { store: broken })).rejects.toThrow(/ENOSPC/)
  })
})
