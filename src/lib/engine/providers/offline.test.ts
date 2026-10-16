/**
 * offline.test.ts —— 离线演示路径的往返测试
 *
 * 这一组测试是 ADR-0003「演示不赌评审当天的网络」的**证据**：
 * 录制 → 落盘 manifest → 换一个 provider 实例回放 → 拿到同样的字节，
 * 全程不发一次网络请求（真发了也不会知道，所以这里用 stub 的 inner 保证没发）。
 *
 * 顺带钉住三条容易退化的行为：
 * - 提示词改一个字 → 回放 miss 并**报错**，不静默换图（放错页比不放更糟）
 * - 路径越界 → 拒写（manifest 可能是别人提交的）
 * - deletePrefix 报条数（删除凭据要写"各删了多少条"）
 */
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from './stores.ts'
import { createFsStore } from './stores.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyManifest,
  loadManifest,
  recordImage,
  recordText,
  createReplayImage,
  createReplayText,
  auditManifest,
} from './replay.ts'
import type { ImageGenerator, TextGenerator } from './types.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

function stubImage(bytes: Uint8Array = PNG): ImageGenerator {
  return {
    id: 'stub-image',
    modelId: 'stub-model',
    supportedRatios: ['1:1'],
    supportsReference: true,
    async generate() {
      return { bytes, mime: 'image/png', modelId: 'stub-model', costCny: 0.2 }
    },
  }
}

function stubText(text: string, streamed = true): TextGenerator {
  return {
    id: 'stub-text',
    modelId: 'stub-model',
    async complete() {
      return { text, modelId: 'stub-model' }
    },
    /**
     * 测试替身的"流"：一次吐完整段，标志由调用方给。
     * ★ 默认 `true` 是把它当**假想的 live**用（它的位置就是 live 那一格）；
     *   要验"转发标志而不是改写标志"时才传 `false`。
     */
    async stream(_req, _budget, onDelta) {
      onDelta({ text, streamed })
      return { text, modelId: 'stub-model' }
    },
  }
}

describe('record → replay', () => {
  it('录下来的图能被原样放回去，且一次网络都不发', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    const recorder = recordImage(
      stubImage(),
      store,
      async () => {
        await store.putJson({ path: 'manifest.json', value: manifest })
      },
      manifest,
    )

    const request = { prompt: '圆脸、深棕圆眼的孩子在草地上仰头', size: '1024x1024' }
    const live = await recorder.generate(request)
    expect(live.bytes).toEqual(PNG)

    const reloaded = await loadManifest(store, 'manifest.json')
    const replay = createReplayImage(store, reloaded)
    const again = await replay.generate(request)
    expect(again.bytes).toEqual(PNG)
    expect(again.costCny).toBe(0) // 回放不花钱，这条要写进成本模型
  })

  it('提示词改一个字 → 明确报错，不放别的页的图、也不回退到网络', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    await recordImage(stubImage(), store, () => {}, manifest).generate({
      prompt: '原来的描述',
      size: '1024x1024',
    })
    const replay = createReplayImage(store, manifest)
    await expect(replay.generate({ prompt: '原来的描述。', size: '1024x1024' })).rejects.toThrow(
      /离线回放里没有这一页的图/,
    )
  })

  it('文本回放按 system+user+温度 认人：换个温度不许复用旧结果', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    const req = { system: 's', user: 'u', temperature: 0.8 }
    await recordText(stubText('{"title":"云"}'), () => {}, manifest).complete(req)

    const replay = createReplayText(store, manifest)
    expect((await replay.complete(req)).text).toBe('{"title":"云"}')
    await expect(replay.complete({ ...req, temperature: 0.2 })).rejects.toThrow(/离线回放里没有/)
  })

  /**
   * 工单 07 §一.2 那一刀：**回放的"流式"是假的，而且它照实说**。
   *
   * 两条断言各挡一种做法：
   * - `streamed: false` —— 挡住"拿定时器把一整段切成打字机"（那是在演示里造假）
   * - 只调一次 onDelta —— 挡住"切成小段发出去但标志写 true"
   *   （标志写 true 的那种，界面会当成真流式逐字动效，而它每一个字都是同一时刻到的）
   */
  it('回放的流式一次吐完整段，且标 streamed:false（不许定时器造假）', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    const req = { system: 's', user: 'u' }
    await recordText(stubText('{"title":"云上的恐龙"}'), () => {}, manifest).complete(req)

    const replay = createReplayText(store, manifest)
    const deltas: { text: string; streamed: boolean }[] = []
    const response = await replay.stream(req, undefined, (delta) => deltas.push({ ...delta }))

    expect(response.text).toBe('{"title":"云上的恐龙"}')
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toEqual({ text: '{"title":"云上的恐龙"}', streamed: false })
  })

  it('录制层原样转发内层的 streamed 标志，不替它回答', async () => {
    const manifest = emptyManifest()
    const seen: boolean[] = []
    const recorder = recordText(stubText('{"title":"x"}', false), () => {}, manifest)
    await recorder.stream({ system: 's', user: 'u' }, undefined, (delta) =>
      seen.push(delta.streamed),
    )
    // 内层说 false，外面就必须是 false——写死 true 的那版会在这里红
    expect(seen).toEqual([false])
    expect(manifest.texts[Object.keys(manifest.texts)[0] ?? '']?.text).toBe('{"title":"x"}')
  })

  it('modelTag 让同一提示词在两个候选模型上各存一条（横评的指纹不能撞车）', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    const recorder = recordImage(stubImage(new Uint8Array([1, 2, 3])), store, () => {}, manifest)
    await recorder.generate({ prompt: '同一句', size: '1024x1024', modelTag: 'wan2.7-image' })
    await recorder.generate({ prompt: '同一句', size: '1024x1024', modelTag: 'qwen-image-2.0' })
    expect(Object.keys(manifest.images)).toHaveLength(2)
  })

  it('auditManifest 能指出被误删的资产', async () => {
    const store = createMemoryStore()
    const manifest = emptyManifest()
    await recordImage(stubImage(), store, () => {}, manifest).generate({
      prompt: 'p',
      size: '1024x1024',
    })
    expect(await auditManifest(store, manifest)).toEqual([])
    const only = Object.values(manifest.images)[0]
    await store.deletePrefix(only?.path.slice(0, 'assets/'.length) ?? '')
    expect((await auditManifest(store, manifest)).length).toBe(1)
  })
})

describe('AssetStore', () => {
  it('put 由 store 算指纹：同样内容两次写入得到同一 digest', async () => {
    const store = createMemoryStore()
    const a = await store.put({ path: 'x/1', bytes: PNG, mime: 'image/png' })
    const b = await store.put({ path: 'x/2', bytes: PNG, mime: 'image/png' })
    expect(a.digest).toBe(b.digest)
  })

  it('deletePrefix 返回删掉的条数（删除凭据的数据源）', async () => {
    const store = createMemoryStore()
    for (const name of ['cards/a/r1.json', 'cards/a/ref.webp', 'cards/b/r1.json']) {
      await store.put({ path: name, bytes: PNG, mime: 'image/png' })
    }
    expect(await store.deletePrefix('cards/a/')).toBe(2)
    expect(await store.list('cards/')).toEqual(['cards/b/r1.json'])
  })

  it('内存与磁盘两个实现对同一组操作给出同样的结果（换实现不换行为）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oum-store-'))
    try {
      const memory = createMemoryStore()
      const disk = await createFsStore(dir)
      for (const store of [memory, disk]) {
        await store.put({ path: 'books/b1/page-1-a1.img', bytes: PNG, mime: 'image/png' })
        await store.putJson({ path: 'books/b1/book.json', value: { bookId: 'b1', n: 1 } })
        expect(await store.read('books/b1/page-1-a1.img')).toEqual(PNG)
        expect(await store.readJson('books/b1/book.json')).toEqual({ bookId: 'b1', n: 1 })
        expect(await store.exists('books/b1/book.json')).toBe(true)
        expect(await store.list('books/')).toEqual(['books/b1/book.json', 'books/b1/page-1-a1.img'])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('磁盘 store 拒绝越界路径（manifest 里的 path 可能是别人写的）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oum-store-'))
    try {
      const store = await createFsStore(dir)
      await expect(
        store.put({ path: '../../escape.img', bytes: PNG, mime: 'image/png' }),
      ).rejects.toThrow(/越界/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
