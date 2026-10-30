/**
 * settle.test.ts —— 启动对账那三条判据（2026-10-30）
 *
 * 判据落在**哪些书号被交给了后端**：这一层唯一的产出就是那张名单，
 * 退多少不归它算（那是 Java 那边按账本封顶的事）。
 *
 * 四个反面与一个正面，每个都对应一种"退错"：
 *   · 画成了的书不该再退（盘上有 `book.json`）
 *   · 画出来过页的不该退（日志里有 `illustration`）
 *   · **删过的书不该退**（没有 `story.json`——删书会把整个目录删掉，
 *     一本画了 8 页被删掉的书，在盘上与"一页没画"长得一模一样）
 *   · 后端没通时别把 8 秒超时乘上书的数量（连着三本没办成就停手）
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { settleOrphanBooks, type SettleOne } from './settle.ts'
import { createUserStore, userSliceRoot } from '../asset-scope.ts'
import { createFsEventLog } from '../event-log.ts'
import { createEventFactory } from '../engine/events.ts'
import { manifestPathOf } from '../engine/index.ts'
import { storyPathOf } from '../story-draft.ts'

const NOW = () => 1_760_000_000_000

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'credits-settle-'))
  dirs.push(dir)
  return dir
}

/** 造一本"故事在、事件日志也在"的书。`pages` = 里面写几条 illustration */
async function seedBook(
  root: string,
  userId: string,
  bookId: string,
  options: { pages?: number; finished?: boolean; story?: boolean } = {},
): Promise<void> {
  const store = await createUserStore(root, userId)
  const log = await createFsEventLog(userSliceRoot(root, userId))
  const emit = createEventFactory(NOW, 0)

  if (options.story !== false) {
    await store.putJson({ path: storyPathOf(bookId), value: { marker: 'story' } })
  }
  // ★ 先 truncate：它会顺手把目录建出来（`append` 不会）。"删过的书"那一种
  //   恰好是"目录里只有一份事件日志"，靠这一步才造得出来
  await log.truncate(bookId)
  // 编故事那一步一定写过一条事件；这里放一条 stage，正是"有日志、没图"的形状
  await log.append(bookId, emit({ kind: 'stage', phase: 'begin' }))
  for (let index = 0; index < (options.pages ?? 0); index += 1) {
    await log.append(
      bookId,
      emit({
        kind: 'illustration',
        stage: 'illustrating',
        assetPath: `books/${bookId}/page-${index}.png`,
        modelId: 'fake-image',
      }),
    )
  }
  if (options.finished === true) {
    await store.putJson({ path: manifestPathOf(bookId), value: { marker: 'book' } })
  }
}

describe('settleOrphanBooks', () => {
  it('只把"没画成、也没删过"的书号交出去', async () => {
    const root = await tempRoot()
    await seedBook(root, '1', 'book-orphan')
    await seedBook(root, '1', 'book-drawn', { pages: 2 })
    await seedBook(root, '1', 'book-done', { finished: true })
    await seedBook(root, '1', 'book-deleted', { story: false })
    await seedBook(root, '2', 'book-other-user')

    const asked: string[] = []
    const settleOne: SettleOne = async (userId, bookId) => {
      asked.push(`${userId}/${bookId}`)
      return 'refunded'
    }

    const report = await settleOrphanBooks({ root, settleOne })

    expect(asked.sort()).toEqual(['1/book-orphan', '2/book-other-user'])
    expect(report).toMatchObject({ users: 2, books: 2, refunded: 2, failed: 0 })
  })

  it('已经结算过的（后端回 none）不算失败，也不算退回', async () => {
    const root = await tempRoot()
    await seedBook(root, '1', 'book-settled')

    const report = await settleOrphanBooks({ root, settleOne: async () => 'none' })

    expect(report).toMatchObject({ books: 1, refunded: 0, failed: 0 })
  })

  it('★ 后端没通：连着三本没办成就停手，别把超时乘上书的数量', async () => {
    const root = await tempRoot()
    for (const id of ['a-book', 'b-book', 'c-book', 'd-book', 'e-book']) {
      await seedBook(root, '1', id)
    }

    const notes: string[] = []
    let calls = 0
    const report = await settleOrphanBooks({
      root,
      note: (line) => notes.push(line),
      settleOne: async () => {
        calls += 1
        return 'failed'
      },
    })

    expect(calls).toBe(3)
    expect(report.failed).toBe(3)
    expect(notes.join('\n')).toContain('后端大概没通')
  })

  it('资产根整个不存在（全新部署）：扫到零本，不报错', async () => {
    const report = await settleOrphanBooks({
      root: join(tmpdir(), 'credits-settle-never-created'),
      settleOne: async () => 'refunded',
    })
    expect(report).toMatchObject({ users: 0, books: 0, refunded: 0, failed: 0 })
  })
})
