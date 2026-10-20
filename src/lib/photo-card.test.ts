/**
 * photo-card.test.ts —— 「用他的照片出一张形象」这条路上**必须被盯住**的几件事
 *
 * 这个文件里最要紧的一组是「照片一个字节都没落盘」。隐私设计 §七 那一行是一句承诺，
 * 而这个仓库的规矩是：**承诺要么有一条会红的用例撑着，要么它就是注释**。
 * 做法是把 `deps.store` 换成一个记账的假 store，然后逐条看它收到了什么字节——
 * 照片的字节是**可辨认的**（下面用一段有特征的内容当"照片"），
 * 于是"它有没有被写下去"这个问题的答案是确定的，不靠读代码时的注意力。
 *
 * 其余几组盯的是同一个思路：**每一个"不该发生的事"都要有一条会红的用例**——
 * 没勾同意时不该调模型、模型没带参考图时不该存卡、失败时不该留下半张卡。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { cardFromPhoto, type PhotoCardDeps } from './photo-card.ts'
import { MAX_PHOTO_BYTES, photoProblems } from './photo-rules.ts'
import { createCardStore } from './engine/character-card/store.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import type { AssetStore, ImageGenerator, PutEntry } from './engine/providers/types.ts'
import type { CharacterAnchor } from './engine/domain.ts'

const ANCHORS: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼' },
  { slot: 'hair', value: '黑发偏软，左上方翘着一撮' },
  { slot: 'build', value: '头身比约 1:4' },
  { slot: 'skin', value: '暖黄偏深的肤色' },
]

/**
 * 一段**能被认出来**的"照片"。
 *
 * ★ 它不是随手造的随机字节：随机字节没法回答"这几个字节是不是那一张照片"。
 *   这里先画一张 400×400 的真 PNG（`normalizeReference` 要解得出宽高），
 *   再在**元数据**里留一个只有这张图才有的标记——PNG 尾部追加的字节
 *   会被 sharp 忽略，但"这段字节有没有出现在别处"是可判定的。
 */
const PHOTO_MARKER = 'PHOTO-MARKER-4f1a9c-DO-NOT-STORE'
async function fakePhoto(): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 210, g: 180, b: 150 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(Buffer.concat([png, Buffer.from(PHOTO_MARKER, 'utf8')]))
}

/** 记账的 store：每次 put 都把**字节**留下来，好在事后问它"见过这段吗" */
function recordingStore(): AssetStore & { written: PutEntry[]; saw(text: string): boolean } {
  const inner = createMemoryStore()
  const written: PutEntry[] = []
  return {
    id: 'recording',
    written,
    saw(text: string): boolean {
      const needle = Buffer.from(text, 'utf8')
      return written.some((entry) => Buffer.from(entry.bytes).includes(needle))
    },
    async put(entry) {
      written.push(entry)
      return inner.put(entry)
    },
    async putJson(entry) {
      const bytes = new TextEncoder().encode(JSON.stringify(entry.value, null, 2))
      written.push({ path: entry.path, bytes, mime: 'application/json' })
      return inner.putJson(entry)
    },
    read: (path) => inner.read(path),
    readJson: (path) => inner.readJson(path),
    exists: (path) => inner.exists(path),
    list: (prefix) => inner.list(prefix),
    deletePrefix: (prefix) => inner.deletePrefix(prefix),
  }
}

/** 一个假的图像适配器。`referenceApplied` 由用例决定，`edit` 记下它收到了什么 */
function fakeImage(options: { applied?: boolean; withEdit?: boolean } = {}) {
  const calls: { prompt: string; referenceDataUrl: string; size: string }[] = []
  const generator = {
    id: 'fake',
    modelId: 'fake-model',
    supportsReference: options.withEdit !== false,
    generate: vi.fn(),
    ...(options.withEdit === false
      ? {}
      : {
          edit: vi.fn(async (req: { prompt: string; referenceDataUrl: string; size: string }) => {
            calls.push(req)
            return {
              bytes: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]),
              mime: 'image/png',
              modelId: 'fake-model',
              referenceApplied: options.applied !== false,
            }
          }),
        }),
  } as unknown as ImageGenerator
  return { generator, calls }
}

async function request(overrides: Partial<Parameters<typeof cardFromPhoto>[0]> = {}) {
  return {
    childId: 'kid-photo',
    name: '小宇',
    ageBand: '4-6',
    childWord: '小男孩',
    anchors: ANCHORS,
    photo: await fakePhoto(),
    consent: true,
    ...overrides,
  }
}

async function depsOf(options: { applied?: boolean; withEdit?: boolean } = {}) {
  const store = recordingStore()
  const image = fakeImage(options)
  const deps: PhotoCardDeps = {
    store,
    cardStore: createCardStore(store),
    image: image.generator,
    now: 1_700_000_000_000,
  }
  return { store, deps, calls: image.calls }
}

describe('★ 照片一个字节都没落盘（隐私设计 §七 那一行的用例）', () => {
  it('存下去的参考图是**模型画出来的那张**，不是照片', async () => {
    const { store, deps } = await depsOf()
    const result = await cardFromPhoto(await request(), deps)

    expect(result.card.reference.bytes).toBe(8)
    expect(result.card.reference.mime).toBe('image/png')
    // 账单式的一问：这个 store 见过的所有字节里，有没有那段照片标记
    expect(store.saw(PHOTO_MARKER)).toBe(false)
  })

  it('★ 连"归一化之后的那一份"也不落盘——store 收到的每一笔都不是那张图', async () => {
    const { store, deps } = await depsOf()
    const req = await request()
    await cardFromPhoto(req, deps)

    // 归一化会改字节（压平 + 缩到 1440），所以那一段标记多半已经被 sharp 丢掉——
    // 于是这里换一个更强的判据：**参考图那一笔的字节数**必须恰好是模型回来那 8 个。
    // 若那张 400×400 的 PNG（或它归一化之后的版本）被写下去过一次，这里会是几万字节
    const refs = store.written.filter((entry) => entry.path.includes('/ref.'))
    expect(refs.map((entry) => entry.bytes.length)).toEqual([8])
    // 落盘的东西只有三类：参考图、卡 JSON、`latest` 那个一字节指针。
    // 多出第四类就是有东西不该写而写了
    for (const entry of store.written) {
      expect(entry.path, `不该落盘的东西：${entry.path}`).toMatch(/\/ref\.|\.json$|\/latest$/)
    }
    expect(store.saw(PHOTO_MARKER)).toBe(false)
  })

  it('卡上只留两个时间戳：用过、什么时候不再需要（`sourcePhoto`）', async () => {
    const { deps } = await depsOf()
    const result = await cardFromPhoto(await request(), deps)
    expect(result.card.sourcePhoto).toEqual({
      usedAt: 1_700_000_000_000,
      deletedAt: 1_700_000_000_000,
    })
    // ★ 这个字段里**没有**任何能还原那张照片的东西：两个数是时间，不是内容
    expect(Object.keys(result.card.sourcePhoto ?? {})).toEqual(['usedAt', 'deletedAt'])
  })
})

describe('没勾同意就不处理', () => {
  it('★ 抛，而且**模型一次都没被调用**——字节连 sharp 都没碰到', async () => {
    const { deps, calls } = await depsOf()
    await expect(cardFromPhoto(await request({ consent: false }), deps)).rejects.toMatchObject({
      code: 'invalid-request',
    })
    expect(calls).toHaveLength(0)
  })

  it('判据里"没同意"那一条排在**最前面**，不会被别的毛病盖住', async () => {
    const problems = photoProblems({
      childId: 'kid-x',
      name: '', // 名字也没填
      ageBand: '4-6',
      childWord: '孩子',
      anchors: ANCHORS,
      photo: new Uint8Array(),
      consent: false,
    })
    expect(problems[0]).toContain('同意')
  })
})

describe('照片本身不合格时，也不留半张卡', () => {
  it('太小（短边 < 240）→ reference-invalid，且 store 一个字节都没收到', async () => {
    const { deps, store } = await depsOf()
    const tiny = new Uint8Array(
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: '#fff' },
      })
        .png()
        .toBuffer(),
    )
    await expect(cardFromPhoto(await request({ photo: tiny }), deps)).rejects.toMatchObject({
      code: 'reference-invalid',
    })
    expect(store.written).toHaveLength(0)
  })

  it('不是图片 → reference-invalid（那句话是给家长读的，不是给排障的）', async () => {
    const { deps } = await depsOf()
    const notAnImage = new TextEncoder().encode('这不是一张图，只是一段字。'.repeat(40))
    await expect(cardFromPhoto(await request({ photo: notAnImage }), deps)).rejects.toMatchObject({
      code: 'reference-invalid',
    })
  })
})

describe('模型那边出了问题，同样不留半张卡', () => {
  it('★ 模型没把照片带过去（`referenceApplied !== true`）→ 抛，卡不建', async () => {
    const { deps, store } = await depsOf({ applied: false })
    await expect(cardFromPhoto(await request(), deps)).rejects.toMatchObject({
      code: 'reference-invalid',
    })
    expect(store.written).toHaveLength(0)
  })

  it('这家模型没有 edit 能力 → 抛，而不是画一张跟照片无关的顶上', async () => {
    const { deps } = await depsOf({ withEdit: false })
    await expect(cardFromPhoto(await request(), deps)).rejects.toMatchObject({
      code: 'reference-invalid',
    })
  })
})

describe('提示词与出处', () => {
  it('送出去的参考图是 data URL，且是**归一化之后**的那一份（PNG）', async () => {
    const { deps, calls } = await depsOf()
    await cardFromPhoto(await request(), deps)
    expect(calls[0]?.referenceDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('prompt 里有那段"参考图是照片"，且锚点一条不少', async () => {
    const { deps, calls } = await depsOf()
    await cardFromPhoto(await request(), deps)
    const prompt = calls[0]?.prompt ?? ''
    expect(prompt).toContain('参考图是孩子本人的照片')
    expect(prompt).toContain('不要照抄照片的姿势')
    for (const anchor of ANCHORS) expect(prompt).toContain(anchor.value)
  })

  it('provenance 记的是 `character-photo@v3`：这条路的提示词与"从零描述"那份不是一份', async () => {
    const { deps } = await depsOf()
    const result = await cardFromPhoto(await request(), deps)
    // ★ 2026-10-20 从 @v2 抬到 @v3：首行那个名字包进了「」（三份模板共用那一行），
    //   所以这一条路的 output 也变了。判据与 v1→v2 同一条：**发出去的字节变了才升**。
    expect(result.card.provenance.promptVersion).toBe('character-photo@v3')
  })

  it('归一化做了什么，逐条回给界面（"我们处理了你的照片"那句话的原料）', async () => {
    const { deps } = await depsOf()
    const result = await cardFromPhoto(await request(), deps)
    expect(result.width).toBe(400)
    expect(result.height).toBe(400)
    // 400×400 没超上限、没有 EXIF，所以唯一的 note 就是压平那一条
    expect(result.notes.join('')).toContain('压平到白底')
  })
})

describe('上限', () => {
  it('`photoProblems` 认出超限，并说出它多大、上限多大', async () => {
    const problems = photoProblems({
      childId: 'kid-x',
      name: '小宇',
      ageBand: '4-6',
      childWord: '孩子',
      anchors: ANCHORS,
      photo: new Uint8Array(MAX_PHOTO_BYTES + 1),
      consent: true,
    })
    expect(problems.join('')).toContain('20.0 MB')
  })
})

/**
 * 照片不进日志、不进事件流。
 *
 * ★ 这一条**不是靠读代码时的注意力**，是靠结构：这条路根本不认识写日志的地方。
 *   所以用例读的是这三个文件的源码，问的是"里面有没有写日志的路"。
 *   它是一道**护栏**，不是一次证明——真正的证明在 `runBook` 那边（事件的唯一写入方），
 *   而它拿到的是卡，卡里只有插画与 `sourcePhoto` 的两个时间戳。
 */
describe('★ 照片不进日志、不进事件流（grep 证据）', () => {
  const files = ['photo-card.ts', 'photo-rules.ts', '../app/api/cards/photo/route.ts']

  it('这三个文件里没有 console、没有 event-log 的 import', () => {
    for (const relative of files) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
      // 只看**代码**，不看注释：注释里出现"日志"两个字是允许的（上面就写着这条纪律）
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      expect(code, `${relative} 里有 console`).not.toMatch(/console\./)
      expect(code, `${relative} 里 import 了事件日志`).not.toMatch(/event-log|EventLog/)
    }
  })
})
