/**
 * book-deletion.test.ts —— 删一本书：「删干净了没有」这件事的用例
 *
 * 最要紧的一组还是缩略图：`thumbs/<档>/books/<bookId>/` 与 `books/` 是平级的两个
 * 位置，只删 `books/<bookId>/` 的话，这本书的每一张图都以 WebP 的形式留在盘上
 * （`child-deletion.ts` 记的那个真实的漏："删了卡没删图"）。
 *
 * 另外三组盯的是同一件事的侧面：
 * - 前缀带尾斜杠：内存 store 是键前缀匹配，传个文件路径进去它会回 1 而 fs 版回 0；
 * - 凭据报的是真删掉的条数，不是删之前枚举出来的那一份（这两者在"正常情况"下相等，
 *   而"正常情况"正是不该被假定的东西）；
 * - 顺序清单也要划掉，否则 `shelf/order.json` 会一直记着几个已经不存在的书号。
 *
 * 没有"预演"那一组：`planBookDeletion` 与它的 `GET` 在 2026-10-16 撤掉了
 *   （用户："就一个确认是否删除，还是算了"）。凭据那句解释（"有什么"）没丢——
 *   它在真删返回的凭据里，由下面 `deleteBookEverywhere` 那几组盯着。
 */

import { describe, expect, it } from 'vitest'

import { bookTargets, deleteBookEverywhere, type BookDeletionDeps } from './book-deletion.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import { manifestPathOf } from './engine/index.ts'
import { putShare, readShare } from './share/store.ts'
import { loadOrder, saveOrder } from './shelf-order.ts'
import { THUMB_WIDTHS } from './thumbs.ts'

const NOW = 1_700_000_000_000
const BOOK = 'probe-01'

type Fixture = {
  store: ReturnType<typeof createMemoryStore>
  deps: BookDeletionDeps
  put(path: string, text?: string): Promise<void>
}

function fixture(): Fixture {
  const store = createMemoryStore()
  return {
    store,
    deps: { store, now: NOW },
    async put(path: string, text = 'x') {
      await store.put({
        path,
        bytes: new TextEncoder().encode(text),
        mime: 'application/octet-stream',
      })
    },
  }
}

/** 一本有图、有朗读、有过程日志、有缩略图的书 */
async function seedBook(f: Fixture, bookId = BOOK): Promise<void> {
  await f.put(manifestPathOf(bookId), JSON.stringify({ tree: { title: '云朵船去旅行' } }))
  await f.put(`books/${bookId}/cover.png`)
  await f.put(`books/${bookId}/page-1-a1.png`)
  await f.put(`books/${bookId}/page-1-a1.mp3`)
  await f.put(`books/${bookId}/events.jsonl`)
  for (const width of THUMB_WIDTHS) {
    await f.put(`thumbs/${width}/books/${bookId}/cover.png.webp`)
  }
}

describe('bookTargets', () => {
  it('各数各的：图 / 朗读 / 过程日志 / 清单，缩略图按档位数', async () => {
    const f = fixture()
    await seedBook(f)
    const targets = await bookTargets(BOOK, f.deps)
    // book.json + cover.png + page-1-a1.png + page-1-a1.mp3 + events.jsonl
    expect(targets.bookFiles).toBe(5)
    expect(targets.images).toBe(2)
    expect(targets.audios).toBe(1)
    expect(targets.logs).toBe(1)
    expect(targets.others).toBe(1)
    expect(targets.thumbDirs).toHaveLength(THUMB_WIDTHS.length)
    expect(targets.thumbFiles).toBe(THUMB_WIDTHS.length)
  })

  it('盘上没有这一本：全 0，且不抛（回什么码是路由的事，见文件头）', async () => {
    const targets = await bookTargets('从来没有过', fixture().deps)
    expect(targets.bookFiles).toBe(0)
    expect(targets.thumbFiles).toBe(0)
    expect(targets.inOrder).toBe(false)
  })
})

describe('deleteBookEverywhere', () => {
  it('★ 书目录与 5 个档位的缩略图全删掉，别的书一根汗毛都不动', async () => {
    const f = fixture()
    await seedBook(f)
    await f.put(manifestPathOf('probe-02'), JSON.stringify({ tree: { title: '旁边那本' } }))
    await f.put(`thumbs/240/books/probe-02/page-1-a1.png.webp`)

    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.complete).toBe(true)
    expect(receipt.totalFiles).toBe(5 + THUMB_WIDTHS.length)
    expect(f.store.all()).toEqual([
      'books/probe-02/book.json',
      'thumbs/240/books/probe-02/page-1-a1.png.webp',
    ])
  })

  it('★ 分享记录跟着书一起删：同一个书号重做一本，旧链接不会复活', async () => {
    const f = fixture()
    await seedBook(f)
    const hash = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    await putShare(f.store, hash, {
      bookId: BOOK,
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      revokedAt: null,
    })
    await putShare(f.store, other, {
      bookId: 'probe-02',
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      revokedAt: null,
    })

    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.complete).toBe(true)
    expect((await bookTargets(BOOK, f.deps)).shareLinks).toBe(0)
    expect(await readShare(f.store, hash)).toBeNull()
    // 别的书的链接一条不动
    expect(await readShare(f.store, other)).not.toBeNull()
    expect(receipt.places.find((one) => one.place === '分享链接')?.deleted).toBe(1)
  })

  it('凭据上那句解释把"这一本有什么"说清楚（数字来自枚举，不估）', async () => {
    const f = fixture()
    await seedBook(f)
    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.title).toBe('云朵船去旅行')
    expect(receipt.places[0]?.note).toBe('2 张图 + 1 段朗读 + 1 份过程日志 + 1 份清单')
  })

  it('没有缩略图时说清为什么是 0（不是含糊过去）', async () => {
    const f = fixture()
    await f.put(manifestPathOf(BOOK), JSON.stringify({ tree: { title: '只有清单' } }))
    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.places[1]?.deleted).toBe(0)
    expect(receipt.places[1]?.note).toContain('还没有被缩过')
  })

  it('书名读不出来就照实说读不出来', async () => {
    const f = fixture()
    await f.put(`books/${BOOK}/page-1-a1.png`)
    expect((await deleteBookEverywhere(BOOK, f.deps)).title).toBe('（读不出来的一本）')
  })

  it('★ 顺序清单里那一本被划掉，别的书号与相对次序不动；文件本身留着', async () => {
    const f = fixture()
    await seedBook(f)
    await saveOrder(f.store, ['probe-03', BOOK, 'probe-02'], NOW)

    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.places.find((one) => one.place === '书架上的顺序记录')?.deleted).toBe(1)
    expect(await loadOrder(f.store)).toEqual(['probe-03', 'probe-02'])
  })

  it('这本不在顺序清单里：报 0，且不把别人的顺序写坏', async () => {
    const f = fixture()
    await seedBook(f)
    await saveOrder(f.store, ['probe-03', 'probe-02'], NOW)
    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.places.find((one) => one.place === '书架上的顺序记录')?.deleted).toBe(0)
    expect(receipt.places.find((one) => one.place === '书架上的顺序记录')?.note).toContain(
      '从来没被拖动过',
    )
    expect(await loadOrder(f.store)).toEqual(['probe-03', 'probe-02'])
  })

  it('删第二遍：全 0、complete 仍是 true（幂等，重试是安全的）', async () => {
    const f = fixture()
    await seedBook(f)
    await deleteBookEverywhere(BOOK, f.deps)
    const again = await deleteBookEverywhere(BOOK, f.deps)
    expect(again.totalFiles).toBe(0)
    expect(again.complete).toBe(true)
    expect(again.places[0]?.note).toContain('盘上没有这一本了')
  })

  it('★ 凭据报的是真删掉的条数：枚举之后偷偷塞进去的文件也数进去了', async () => {
    const f = fixture()
    await seedBook(f)
    // 枚举出来是 5 + 5；删之前再塞一个，凭据就该报 6 + 5——那个数出自 `deletePrefix`，
    // 不是出自那一次枚举
    expect((await bookTargets(BOOK, f.deps)).bookFiles).toBe(5)
    await f.put(`books/${BOOK}/page-2-a1.png`)
    expect((await deleteBookEverywhere(BOOK, f.deps)).totalFiles).toBe(11)
  })

  it('一个位置失败不放弃其它位置，但 complete 必须是 false 且带原话', async () => {
    const f = fixture()
    await seedBook(f)
    const real = f.store.deletePrefix.bind(f.store)
    f.store.deletePrefix = (async (prefix: string) => {
      if (prefix.startsWith('books/')) throw new Error('磁盘满了')
      return real(prefix)
    }) as typeof f.store.deletePrefix

    const receipt = await deleteBookEverywhere(BOOK, f.deps)
    expect(receipt.complete).toBe(false)
    expect(receipt.places[0]?.failed).toBe('磁盘满了')
    // 缩略图照删：删到一半停下，剩下的东西比删完更糟
    expect(receipt.places[1]?.deleted).toBe(THUMB_WIDTHS.length)
  })
})
