/**
 * asset-scope.test.ts —— 归属那道缝的四条判据
 *
 * ★ 最要紧的一条是「写下去的路径带前缀、交回来的不带」。它错了的症状很远：
 *   路径带着 `u/3/` 进 `book.json`，然后 `assetPathInDemo` 摘不掉、
 *   导出演示书读不出来、阅读器 404——而那时候没人会想到是这一层。
 *
 * 用 `createMemoryStore` 当底，不碰磁盘：这些判据与文件系统无关，
 *   而与"两个人会不会串"有关。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createUserStore, scopePrefixOf, scopedStore } from './asset-scope.ts'
import { createFsStore, createMemoryStore } from './engine/providers/stores.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const textOf = (raw: Uint8Array | null): string | null =>
  raw === null ? null : new TextDecoder().decode(raw)

/** 一个能被翻出全部物理路径的内存版（`createMemoryStore` 的 `all()` 是测试辅助） */
function base() {
  return createMemoryStore()
}

describe('★ 写下去带前缀，交回来不带', () => {
  it('put 的返回值里是**逻辑**路径（清单里记的就是它）', async () => {
    const store = scopedStore(base(), '3')
    const ref = await store.put({
      path: 'books/b1/page-1-a1.png',
      bytes: bytes('x'),
      mime: 'image/png',
    })
    expect(ref.path).toBe('books/b1/page-1-a1.png')
  })

  it('putJson 同上', async () => {
    const store = scopedStore(base(), '3')
    const ref = await store.putJson({ path: 'books/b1/book.json', value: { title: '云' } })
    expect(ref.path).toBe('books/b1/book.json')
  })

  it('★ 而磁盘上真的落在 u/<id>/ 之下', async () => {
    const memory = base()
    const store = scopedStore(memory, '3')
    await store.put({ path: 'books/b1/page-1-a1.png', bytes: bytes('x'), mime: 'image/png' })
    expect(memory.all()).toEqual(['u/3/books/b1/page-1-a1.png'])
  })

  it('`originUrl` 那两个字段照旧带着（只改 path，别的一律不动）', async () => {
    const store = scopedStore(base(), '3')
    const ref = await store.put({
      path: 'cards/c1/ref.abc123.png',
      bytes: bytes('x'),
      mime: 'image/png',
      originUrl: 'https://example.test/tmp.png',
      originExpiresAt: 1_700_000_000_000,
    })
    expect(ref.originUrl).toBe('https://example.test/tmp.png')
    expect(ref.originExpiresAt).toBe(1_700_000_000_000)
  })
})

describe('★ 没有主人就当场炸（防的是我们自己忘了那道闸）', () => {
  it('空 / undefined / 字面量 "undefined" 一律拒', async () => {
    // ★ 漏掉登录闸时 `guard.session.userId` 就是 undefined，而 `u/undefined/`
    //   看起来是通的：存得下、读得回、界面无异常，只是陌生人共用一片。
    //   所以这里要求它响——症状从"悄悄串号"变成"500 + 一句说清的话"。
    for (const bad of ['', '   ', undefined, null, 'undefined', 'null']) {
      expect(() => scopedStore(base(), bad as string)).toThrow()
      await expect(createUserStore('.', bad as string)).rejects.toThrow()
    }
  })

  it('正常的用户号照过，且前后空白剪掉', () => {
    expect(scopedStore(base(), ' 7 ').id).toBe('memory#u7')
  })
})

describe('★ 两个人互不串门', () => {
  it('同一条逻辑路径，两个人各写各的，读到的是各自那份', async () => {
    const memory = base()
    const a = scopedStore(memory, '1')
    const b = scopedStore(memory, '7')
    await a.put({ path: 'books/b1/book.json', bytes: bytes('A 的书'), mime: 'application/json' })
    await b.put({ path: 'books/b1/book.json', bytes: bytes('B 的书'), mime: 'application/json' })

    expect(textOf(await a.read('books/b1/book.json'))).toBe('A 的书')
    expect(textOf(await b.read('books/b1/book.json'))).toBe('B 的书')
    expect(memory.all().sort()).toEqual(['u/1/books/b1/book.json', 'u/7/books/b1/book.json'])
  })

  it('★ 别人的书 id：在你自己那一片里**根本不存在**（404 是这么来的）', async () => {
    const memory = base()
    const a = scopedStore(memory, '1')
    const b = scopedStore(memory, '7')
    await a.put({ path: 'books/secret/book.json', bytes: bytes('A'), mime: 'application/json' })

    // B 拿着 A 的书 id 来读：不是"读了再判"，是那一片里没有这个键
    expect(await b.read('books/secret/book.json')).toBeNull()
    expect(await b.exists('books/secret/book.json')).toBe(false)
    expect(await b.readJson('books/secret/book.json')).toBeNull()
  })

  it('list 只列自己那一片，而且路径不带前缀', async () => {
    const memory = base()
    const a = scopedStore(memory, '1')
    const b = scopedStore(memory, '7')
    await a.put({ path: 'books/b1/book.json', bytes: bytes('a'), mime: 'application/json' })
    await b.put({ path: 'books/b2/book.json', bytes: bytes('b'), mime: 'application/json' })

    expect(await a.list('books/')).toEqual(['books/b1/book.json'])
    expect(await b.list('books/')).toEqual(['books/b2/book.json'])
  })

  it('★ 前缀那个斜杠是承重的：u/1/ 不能命中 u/10/', async () => {
    const memory = base()
    await scopedStore(memory, '10').put({
      path: 'books/x/book.json',
      bytes: bytes('x'),
      mime: 'application/json',
    })
    const one = scopedStore(memory, '1')
    expect(await one.list('books/')).toEqual([])
    expect(scopePrefixOf('1')).toBe('u/1/')
  })

  it('deletePrefix 只删自己那一片，报的条数也是自己那几条', async () => {
    const memory = base()
    const a = scopedStore(memory, '1')
    const b = scopedStore(memory, '7')
    await a.put({ path: 'books/b1/page-1-a1.png', bytes: bytes('a'), mime: 'image/png' })
    await a.put({ path: 'books/b1/book.json', bytes: bytes('a'), mime: 'application/json' })
    await b.put({ path: 'books/b1/page-1-a1.png', bytes: bytes('b'), mime: 'image/png' })

    expect(await a.deletePrefix('books/b1')).toBe(2)
    // B 那份必须还在——"一键删除"删到别人头上是这一层最坏的错
    expect(await b.exists('books/b1/page-1-a1.png')).toBe(true)
  })

  it('list 的前缀是空的时，列的是自己那一片的全部', async () => {
    const memory = base()
    const a = scopedStore(memory, '1')
    await a.put({ path: 'books/b1/book.json', bytes: bytes('a'), mime: 'application/json' })
    await a.put({ path: 'cards/c1/ref.abcdef123456.png', bytes: bytes('a'), mime: 'image/png' })
    expect(await a.list('')).toEqual(['books/b1/book.json', 'cards/c1/ref.abcdef123456.png'])
  })
})

describe('★ 越界：跑出自己那一片（这条洞是单元测试先照出来的）', () => {
  /**
   * ★ 这一组测的是这一层自己新增的那条边界，不是底层那条。
   *
   * 攻击是这样的：`/api/assets/../u/7/books/x/book.json` 这个 URL 攻击者随便写。
   * 拼上 3 号的前缀得到 `u/3/../u/7/books/x/book.json`，`path.resolve` 之后**正好是
   * `u/7/books/x/book.json`——在资产根之内**，所以底层的"还在 base 之下"完全满意。
   *
   * 第一版没有这道检查，而我当时那条测试写的是"put 越界会抛"，用的是 `../../`：
   * 加了 `u/3/` 前缀之后它正好落在根上、没抛，测试红了。红的原因不是测试写错了。
   */
  it('★ 拿 `..` 爬出自己那一片去读别人的书 → 抛（不是读到）', async () => {
    const memory = base()
    await scopedStore(memory, '7').put({
      path: 'books/secret/book.json',
      bytes: bytes('7 号的书'),
      mime: 'application/json',
    })

    const three = scopedStore(memory, '3')
    await expect(three.read('../u/7/books/secret/book.json')).rejects.toThrow()
    await expect(three.exists('../u/7/books/secret/book.json')).rejects.toThrow()
    await expect(three.readJson('../u/7/books/secret/book.json')).rejects.toThrow()
  })

  it('★ 写与列、删也一样拦（每一处进出口都过那道）', async () => {
    const store = scopedStore(base(), '3')
    await expect(
      store.put({ path: '../u/7/x.png', bytes: bytes('x'), mime: 'image/png' }),
    ).rejects.toThrow()
    await expect(store.list('../u/7/')).rejects.toThrow()
    await expect(store.deletePrefix('../u/7/')).rejects.toThrow()
  })

  it('★ Windows 的反斜杠也当分隔符看（2026-10-22 审查）', async () => {
    // `path.resolve` 在 win32 上把 `\` 当分隔符，而 Next 会把 `%5c` 解码成 `\`。
    // 只按 `/` 切的话，这一条会在这里放行、到磁盘上却真的出了 u/3/。
    const store = scopedStore(base(), '3')
    await expect(store.read('books\\..\\..\\u\\7\\books\\secret\\book.json')).rejects.toThrow()
    await expect(
      store.put({ path: 'books\\..\\..\\u\\7\\x.png', bytes: bytes('x'), mime: 'image/png' }),
    ).rejects.toThrow()
  })

  it('★ 判据只拒 `..` 那一段，不误伤带点的文件名', async () => {
    const store = scopedStore(base(), '3')
    // `a..b.png` 是合法文件名；整条路上引擎生成的名字里也确实没有 `..` 段
    await store.put({ path: 'books/b1/a..b.png', bytes: bytes('x'), mime: 'image/png' })
    expect(await store.exists('books/b1/a..b.png')).toBe(true)
    await store.put({
      path: 'children/kid-1..2.json',
      bytes: bytes('{}'),
      mime: 'application/json',
    })
    expect(await store.exists('children/kid-1..2.json')).toBe(true)
  })

  it('底层那条根越界检查仍然在，只是从这一层**走不到它**了', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'asset-scope-test-'))
    try {
      // 直接打底层 store（不经包装）：`put` 不吞错，所以根越界在这里是响的
      const bare = await createFsStore(dir)
      await expect(
        bare.put({ path: '../escape.txt', bytes: bytes('x'), mime: 'text/plain' }),
      ).rejects.toThrow()

      // 而包装之后够不到这条检查了：`u/3/../../escape.txt` 会先被这一层的
      //   守卫拦下（它拒的是"跑出自己那一片"，比"跑出资产根"更严）。
      //   所以这条检查现在是给别的调用方（开发脚本直接拿根 store）兜底的，
      //   不再是唯一一条线——两层的判据各管各的（见 `asset-scope.ts` 第 3 条）。
      const wrapped = await createUserStore(dir, '3')
      await expect(
        wrapped.put({ path: '../../escape.txt', bytes: bytes('x'), mime: 'text/plain' }),
      ).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('`read` 把"越界"与"不存在"都吞成 null——这是那条出口的既定语义', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'asset-scope-test-'))
    try {
      const bare = await createFsStore(dir)
      // `/api/assets` 的文件头写着"越界与不存在对外是同一件事"，就是这么来的
      expect(await bare.read('../../etc/passwd')).toBeNull()

      // 而那不等于"什么都读不到"：真有的东西照样读得到
      await bare.put({ path: 'books/b1/book.json', bytes: bytes('ok'), mime: 'application/json' })
      expect(textOf(await bare.read('books/b1/book.json'))).toBe('ok')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('★ 内存版根本没有根越界检查——这正是守卫必须放在**两层共用**那一层的原因', async () => {
    // 记录事实：内存版的键就是字符串，`../` 对它毫无意义（它也不碰磁盘）。
    //   所以"跑出资产根"这件事只有磁盘版拦；而"跑出自己那一片"这一层
    //   必须自己拦——否则换一个 store 实现（`AssetStore` 本来就可换，
    //   部署那一步要加 S3 版）就等于把那条边界丢了。
    const bare = createMemoryStore()
    await bare.put({ path: '../escape', bytes: bytes('x'), mime: 'text/plain' })
    expect(bare.all()).toEqual(['../escape'])

    // 而经包装之后，两种实现都拦得住
    await expect(
      scopedStore(createMemoryStore(), '3').put({
        path: '../escape',
        bytes: bytes('x'),
        mime: 'text/plain',
      }),
    ).rejects.toThrow()
  })
})
