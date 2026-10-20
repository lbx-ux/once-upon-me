/**
 * stores.test.ts —— `extensionOf`：资产文件名要能被浏览器直接认
 *
 * 这一条是被实测抓出来的，不是推演出来的：
 *   百炼的语音接口回的 content-type 是 **`audio/mpeg`**，而它不含 `mp3` 这三个字符，
 *   于是音频资产落成了 `page-1-a1.bin`（2026-10-14，`.out/tts-int.mts` 第一次跑）。
 *   症状很轻——字节是对的、能播——但文件名在撒谎，而文件名是排障时唯一先看到的东西。
 *
 * 顺带锁住 `video/mpeg` 不许被叫成 `.mp3`：这就是"笼统写 includes('mpeg')"会踩的坑。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createFsStore, createMemoryStore, extensionOf } from './stores.ts'
import type { AssetStore } from './types.ts'

describe('extensionOf · 音频要认得出', () => {
  it('audio/mpeg → .mp3（实测那个 mime 就是它）', () => {
    expect(extensionOf('audio/mpeg')).toBe('.mp3')
    expect(extensionOf('audio/mp3')).toBe('.mp3')
    expect(extensionOf('audio/mpeg; charset=binary')).toBe('.mp3')
  })

  it('但 video/mpeg 不是 mp3', () => {
    expect(extensionOf('video/mpeg')).not.toBe('.mp3')
  })

  it('wav / m4a（克隆样本那两种格式）', () => {
    expect(extensionOf('audio/wav')).toBe('.wav')
    expect(extensionOf('audio/x-wav')).toBe('.wav')
    expect(extensionOf('audio/m4a')).toBe('.m4a')
    expect(extensionOf('audio/x-m4a')).toBe('.m4a')
  })
})

describe('extensionOf · 原有的几条没被改坏', () => {
  it('图像与 json 仍然对', () => {
    expect(extensionOf('image/png')).toBe('.png')
    expect(extensionOf('image/webp')).toBe('.webp')
    expect(extensionOf('image/jpeg')).toBe('.jpg')
    expect(extensionOf('application/json')).toBe('.json')
  })

  it('大小写不敏感；认不出来才回 .bin', () => {
    expect(extensionOf('IMAGE/PNG')).toBe('.png')
    expect(extensionOf('application/octet-stream')).toBe('.bin')
  })
})

/**
 * ★ `deletePrefix` 的两个实现必须回同一个数（2026-10-15 补）。
 *
 * 这一组的方式是"同一套动作、两个 store 各跑一遍"，而不是各写一份预期值：
 * 那条契约（`AssetStore.deletePrefix` 的注释：删除凭据要列明"各删了多少条"）
 * 说的是报数，所以能被违反的方式只有一种——两个实现报出不一样的数。
 *
 * 实测到的那一次就是这样：前缀落在一个文件上（`children/<id>.json`，
 * `profileStore.delete` 正是这么调的），内存版按键前缀匹配回 1，
 * 而 fs 版 `readdir(文件)` 抛 ENOENT 被吞掉 → 回 0，可它照样把文件删了。
 * 于是凭据上"档案"那一行写着 0 条，而档案已经没了——
 * 发现它靠的是 `scripts/e2e-delete-child.mts`：预演说一共 5 条、真删说 4 条。
 */
describe('deletePrefix · 两个 store 对同一种输入回同一个数', () => {
  const cases = [
    { what: '目录前缀（卡目录就是这样）', prefix: 'cards/c1/', expect: 3 },
    { what: '★ 文件前缀（档案就是这样）', prefix: 'children/kid-a.json', expect: 1 },
    { what: '不存在的路径：0 条不是错误', prefix: 'cards/meiyou/', expect: 0 },
  ]

  it('内存 store', async () => {
    for (const one of cases) {
      const store = createMemoryStore()
      await seedFor(store)
      expect(await store.deletePrefix(one.prefix), one.what).toBe(one.expect)
    }
  })

  it('fs store（写真的文件系统）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stores-del-'))
    try {
      for (const one of cases) {
        const store = await createFsStore(root)
        await seedFor(store)
        expect(await store.deletePrefix(one.prefix), one.what).toBe(one.expect)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('★ 而且删完之后两边**剩下的东西也一样**（只对上数字、东西还在更糟）', async () => {
    const keysFor = async (store: AssetStore): Promise<string[]> => (await store.list('')).sort()

    const memory = createMemoryStore()
    await seedFor(memory)
    await memory.deletePrefix('children/kid-a.json')
    await memory.deletePrefix('cards/c1/')

    const root = await mkdtemp(join(tmpdir(), 'stores-del-'))
    try {
      const fsStore = await createFsStore(root)
      await seedFor(fsStore)
      await fsStore.deletePrefix('children/kid-a.json')
      await fsStore.deletePrefix('cards/c1/')
      expect(await keysFor(fsStore)).toEqual(await keysFor(memory))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

/** 一棵最小的资产树：一张卡（3 个文件）、一条档案、另一个孩子的一张卡 */
async function seedFor(store: AssetStore): Promise<void> {
  const put = (path: string) => store.put({ path, bytes: new Uint8Array([1]), mime: 'x/y' })
  await put('cards/c1/r1.abc.json')
  await put('cards/c1/ref.abc.png')
  await put('cards/c1/latest')
  await put('cards/c2/ref.def.png')
  await put('children/kid-a.json')
}
