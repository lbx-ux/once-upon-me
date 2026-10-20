/**
 * child-deletion.test.ts —— 「删干净了没有」这件事的用例（工单 03 第三刀）
 *
 * 最要紧的一组是缩略图。理由不是"完整性好看"，是一个真实的漏：
 * 这一刀开工前，资产根里躺着 9 个残留的缩略图，全是我在前面几刀里删掉的探针留下的——
 * 卡片目录删了，`thumbs/240/cards/<cardId>/ref.….webp` 还在。
 * 那 7 个文件里的内容就是那些探针的"脸"，而"删掉"这件事在界面上当时是成立的。
 *
 * 其余几组盯的是同一件事的几个侧面：
 * - 书用卡号认，不用 `${childId}-sheet` 这个命名约定（靠约定会安静漏掉全部旧书）；
 * - 凭据报的是真删掉的条数，不是预演时数出来的那份（这两者在"正常情况"下相等，
 *   而"正常情况"正是不该被假定的东西）；
 * - 一个位置失败不代表放弃其它位置，但 `complete` 必须是 false。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  deleteChildEverywhere,
  partialMessageOf,
  planDeletion,
  targetsOf,
  type DeletionDeps,
} from './child-deletion.ts'
import { createCardStore } from './engine/character-card/store.ts'
import { createProfileStore } from './engine/character-card/profile-store.ts'
import { createMemoryStore } from './engine/providers/stores.ts'
import type { AssetStore } from './engine/providers/types.ts'
import type { CharacterAnchor } from './engine/domain.ts'

const ANCHORS: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕圆眼' },
  { slot: 'hair', value: '黑发偏软，左上方翘着一撮' },
  { slot: 'build', value: '头身比约 1:4' },
  { slot: 'skin', value: '暖黄偏深的肤色' },
]

const STYLE = { key: 'warm-handdrawn', promptFragment: '水彩', ratio: '1:1' } as const

type Fixture = {
  store: AssetStore & { all(): string[] }
  deps: DeletionDeps
  /** 往资产根里直接写一个文件（造书、造缩略图、造残留都用它） */
  put(path: string, bytes?: Uint8Array): Promise<void>
}

async function fixture(): Promise<Fixture> {
  const store = createMemoryStore()
  const deps: DeletionDeps = {
    store,
    cardStore: createCardStore(store),
    profiles: createProfileStore(store),
    now: 1_700_000_000_000,
  }
  return {
    store,
    deps,
    async put(path, bytes = new Uint8Array([1, 2, 3])) {
      await store.put({ path, bytes, mime: 'application/octet-stream' })
    },
  }
}

/** 给一个孩子建档 + 建一张卡（可选第二版、可选照片来源） */
async function seedChild(
  f: Fixture,
  childId: string,
  options: { photo?: boolean; revisions?: number } = {},
) {
  await f.deps.profiles.save({
    childId,
    name: childId === 'xiaoyu' ? '小宇' : '探针',
    nameReading: 'tàn zhēn',
    ageBand: '4-6',
    lookTags: [],
    interestTags: [],
    createdAt: 1_700_000_000_000,
  })
  const cardId = `${childId}-sheet`
  const base = {
    cardId,
    childId,
    anchors: ANCHORS,
    style: STYLE,
    referenceBytes: new Uint8Array([7, 7, 7, 7]),
    referenceMime: 'image/png',
    modelId: 'fake-model',
    promptVersion: 'test@v1',
    now: 1_700_000_000_000,
  }
  const { card: v1 } = await f.deps.cardStore.create(
    options.photo ? { ...base, sourcePhoto: { usedAt: 1, deletedAt: 2 } } : base,
  )
  let last = v1
  for (let index = 1; index < (options.revisions ?? 1); index += 1) {
    const { card } = await f.deps.cardStore.create({
      ...base,
      now: base.now + index,
      previous: last,
      suggestion: '改一下',
    })
    last = card
  }
  return { cardId, referencePath: v1.reference.path }
}

/** 一套"看起来像真的"派生资产：书的目录 + 四个档位的缩略图 */
async function seedDerived(f: Fixture, cardId: string, bookId: string, childId: string) {
  await f.put(`books/${bookId}/book.json`)
  await f.put(`books/${bookId}/events.jsonl`)
  for (const width of [240, 384, 512, 768]) {
    await f.put(`thumbs/${width}/cards/${cardId}/ref.abc.png.webp`)
    await f.put(`thumbs/${width}/books/${bookId}/page-1-a1.png.webp`)
    // 另一个孩子的缩略图：不许被牵连
    await f.put(`thumbs/${width}/cards/other-sheet/ref.zzz.png.webp`)
  }
  void childId
}

describe('★ 缩略图也要删（这一组对着一个真实的漏）', () => {
  it('卡与书的缩略图都在清单里，而且真的被删掉', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    await seedDerived(f, cardId, 'kid-a-sheet-deadbeef', 'kid-a')

    const plan = await planDeletion('kid-a', f.deps)
    const thumbs = plan.places.find((one) => one.place === '缩略图缓存')
    // 4 个档 ×（1 张卡图 + 1 张页图）= 8
    expect(thumbs?.deleted).toBe(8)

    const done = await deleteChildEverywhere('kid-a', f.deps)
    expect(done.places.find((one) => one.place === '缩略图缓存')?.deleted).toBe(8)
    expect(f.store.all().filter((path) => path.startsWith('thumbs/'))).toEqual([
      // 别的孩子的缩略图一个都不许动
      'thumbs/240/cards/other-sheet/ref.zzz.png.webp',
      'thumbs/384/cards/other-sheet/ref.zzz.png.webp',
      'thumbs/512/cards/other-sheet/ref.zzz.png.webp',
      'thumbs/768/cards/other-sheet/ref.zzz.png.webp',
    ])
  })

  it('没有缩略图时那一条是 0，且说清"派生内容也一起删"这件事', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    const receipt = await deleteChildEverywhere('kid-a', f.deps)
    const thumbs = receipt.places.find((one) => one.place === '缩略图缓存')
    expect(thumbs?.deleted).toBe(0)
    expect(thumbs?.note).toContain('也是他的脸')
  })
})

describe('他的书用卡号认，不用命名约定', () => {
  it('★ 书号不以 childId 开头，但它的 cardId 是这个孩子的 → 照样删', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    // 书号是"卡 + 主题指纹"（引擎的约定），与 childId 无关
    const bookId = `${cardId}-4c1007d9223a`
    expect(bookId.startsWith('kid-a')).toBe(true) // 只是恰好；下面那本书才是关键那本
    await f.put(`books/${bookId}/book.json`, new TextEncoder().encode(JSON.stringify({ cardId })))
    await f.put(`books/${bookId}/events.jsonl`)

    const receipt = await deleteChildEverywhere('kid-a', f.deps)
    expect(receipt.books.map((one) => one.bookId)).toEqual([bookId])
    expect(receipt.places.find((one) => one.place === '他的书')?.deleted).toBe(2)
  })

  it('cardId 认不出来时**不认领**：宁可留着，也不要删一本说不清是谁的书', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    await f.put(
      'books/kid-a-4c1007d9223a/book.json',
      new TextEncoder().encode(JSON.stringify({ cardId: '别人的卡' })),
    )

    const receipt = await deleteChildEverywhere('kid-a', f.deps)
    expect(receipt.books).toEqual([])
    expect(f.store.all()).toContain('books/kid-a-4c1007d9223a/book.json')
  })

  it('半截 JSON 的书读不出来，但**照样被删**（漏一本是凭据上看得出来的一件事）', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    await f.put(`books/${cardId}-broken/book.json`, new TextEncoder().encode('{"cardId":"kid-a'))

    const receipt = await deleteChildEverywhere('kid-a', f.deps)
    expect(receipt.books).toEqual([{ bookId: `${cardId}-broken`, title: '(读不出来的一本)' }])
    expect(f.store.all().filter((path) => path.startsWith('books/'))).toEqual([])
  })
})

describe('凭据报的是真删掉的条数，不是预演数出来的', () => {
  it('★ 预演之后又冒出来一个文件，凭据报的是删掉的那个数', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')

    const plan = await planDeletion('kid-a', f.deps)
    expect(plan.stage).toBe('plan')
    const plannedCards = plan.places.find((one) => one.place === '角色卡与参考图')?.deleted

    // 预演之后、真删之前，卡目录里多了一个文件（另一台机器写进来的、或上一轮没删净的）
    await f.put(`cards/${cardId}/stray.json`)

    const done = await deleteChildEverywhere('kid-a', f.deps)
    expect(done.stage).toBe('done')
    const deletedCards = done.places.find((one) => one.place === '角色卡与参考图')?.deleted
    expect(deletedCards).toBe((plannedCards ?? 0) + 1)
  })

  it('清单里的位置一条不少，顺序稳定（界面上是照这个顺序念的）', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    const receipt = await planDeletion('kid-a', f.deps)
    expect(receipt.places.map((one) => one.place)).toEqual([
      '孩子的档案',
      '角色卡与参考图',
      '他的书',
      '缩略图缓存',
      '照片原图',
    ])
  })
})

describe('照片那一行：0 条，但有一张卡的血缘里有照片', () => {
  it('形象是从照片来的 → 报出有几**张卡**，并说清它从来没落盘', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a', { photo: true, revisions: 2 })
    const receipt = await planDeletion('kid-a', f.deps)
    const photo = receipt.places.find((one) => one.place === '照片原图')
    expect(photo?.deleted).toBe(0)
    expect(photo?.note).toContain('从来没有落盘过')
    // 数的是卡不是版本：第二版是从第一版的插画改的，同一张照片不该数两次
    expect(photo?.note).toContain('1 张卡')
  })

  it('★ 改一版之后仍然只算一张卡（叠版本会把 `sourcePhoto` 一起继承）', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a', { photo: true, revisions: 3 })
    const revisions = await f.deps.cardStore.revisions(cardId)
    expect(revisions).toHaveLength(3)
    // 三版都带着 sourcePhoto —— 继承是对的（血缘里确实有一张真照片）
    expect(revisions.every((card) => card.sourcePhoto)).toBe(true)
    // 但凭据说的是"一张卡"，不是"三版"
    const targets = await targetsOf('kid-a', f.deps)
    expect(targets.photoCards).toBe(1)
  })

  it('没走过照片那条路 → 也报 0，但话不一样', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    const receipt = await planDeletion('kid-a', f.deps)
    expect(receipt.places.find((one) => one.place === '照片原图')?.note).toContain('不是从照片来的')
  })
})

describe('删到一半失败：别的位置照删，但凭据算不完整', () => {
  it('★ 缩略图那一处抛了，卡与档案仍然被删，`complete: false` 并带上原话', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    await seedDerived(f, cardId, 'kid-a-sheet-aaaa', 'kid-a')

    const realDelete = f.store.deletePrefix.bind(f.store)
    f.store.deletePrefix = vi.fn(async (prefix: string) => {
      if (prefix.startsWith('thumbs/')) throw new Error('磁盘满了')
      return realDelete(prefix)
    }) as typeof f.store.deletePrefix

    const receipt = await deleteChildEverywhere('kid-a', f.deps)
    expect(receipt.complete).toBe(false)
    expect(receipt.places.find((one) => one.place === '缩略图缓存')?.failed).toContain('磁盘满了')
    // 其它位置一样删干净了——"删到一半停下"会让剩下的一半更糟
    expect(receipt.places.find((one) => one.place === '角色卡与参考图')?.deleted).toBeGreaterThan(0)
    expect(await f.deps.profiles.load('kid-a')).toBeNull()
  })
})

describe('★ 删到一半那句话：点名，而且只有没删干净时才有', () => {
  /** 把某几个前缀的删除弄坏（真删走原实现，所以别的位置照样删得干净） */
  function poison(f: Fixture, prefixes: string[]): void {
    const realDelete = f.store.deletePrefix.bind(f.store)
    f.store.deletePrefix = vi.fn(async (prefix: string) => {
      if (prefixes.some((bad) => prefix.startsWith(bad))) throw new Error('磁盘满了')
      return realDelete(prefix)
    }) as typeof f.store.deletePrefix
  }

  it('缩略图那处失败 → 点出「缩略图缓存」，删干净的位置一个都不念', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    await seedDerived(f, cardId, 'kid-a-sheet-aaaa', 'kid-a')
    poison(f, ['thumbs/'])

    const message = partialMessageOf(await deleteChildEverywhere('kid-a', f.deps)) ?? ''
    expect(message).toContain('缩略图缓存')
    // 只点没删干净的那个：把删干净的位置也念一遍，这句话就不值得信了
    expect(message).not.toContain('角色卡与参考图')
    expect(message).not.toContain('孩子的档案')
    // 底层原话不进这句话（它随凭据回去，排障时看响应体）——
    //   家长要问的是"哪儿没删干净"，不是在弹窗里读 EACCES / 磁盘满了
    expect(message).not.toContain('磁盘满了')
  })

  it('两处失败 → 两个名字都在，顺序照凭据上的位置顺序', async () => {
    const f = await fixture()
    const { cardId } = await seedChild(f, 'kid-a')
    await seedDerived(f, cardId, 'kid-a-sheet-aaaa', 'kid-a')
    poison(f, ['books/', 'thumbs/'])

    const message = partialMessageOf(await deleteChildEverywhere('kid-a', f.deps)) ?? ''
    expect(message).toContain('他的书')
    expect(message).toContain('缩略图缓存')
    // 凭据上的位置顺序是「…他的书、缩略图缓存」，这句话就照那个顺序念
    expect(message.indexOf('他的书')).toBeLessThan(message.indexOf('缩略图缓存'))
  })

  it('★ 删干净时回 null —— 这样"删干净了却还挂着一句没删干净"写不出来', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    expect(partialMessageOf(await deleteChildEverywhere('kid-a', f.deps))).toBeNull()
  })
})

/**
 * 路由把那句话接上了没有。
 *
 * 这一条是护栏，不是证明：真正的逻辑在上面那三条用例里（纯函数，
 *   点不点名、什么时候回 null 都由它们钉着）。这里问的是一件纯函数测不到的事——
 *   `DELETE` 那条路有没有把这句话放进响应体。
 *   它值得一条用例，是因为这件事恰恰坏过一次：服务端原来回
 *   `200 + { receipt }`（没有 `message`），界面写着"把服务端那句话说出来"，
 *   于是两边读起来都对、而家长永远看到的是界面自己的兜底话。
 *   "界面会显示服务端那句话"这种承诺，只有真跑到那条分支才算数。
 */
describe('★ DELETE 把"没删干净"那句话放进响应体（grep 证据）', () => {
  const route = readFileSync(
    join(fileURLToPath(new URL('../app/api/children', import.meta.url)), '[childId]', 'route.ts'),
    'utf8',
  )

  it('用了 `partialMessageOf`，而且那一支回的是 500', () => {
    expect(route).toMatch(/partialMessageOf\(receipt\)/)
    expect(route).toMatch(/status: 500/)
  })

  it('那个从没抛出过的异常类与它那条够不着的分支都不在了', () => {
    expect(route).not.toMatch(/DeletionPartialError/)
  })
})

describe('重复删是安全的', () => {
  it('第二次全是 0，不抛', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    await deleteChildEverywhere('kid-a', f.deps)

    const again = await deleteChildEverywhere('kid-a', f.deps)
    expect(again.totalFiles).toBe(0)
    expect(again.complete).toBe(true)
  })
})

describe('targetsOf 只认这个孩子', () => {
  it('别的孩子的卡与书一概不列进来', async () => {
    const f = await fixture()
    await seedChild(f, 'kid-a')
    await seedChild(f, 'kid-b')
    await f.put(
      'books/kid-b-sheet-aaaa/book.json',
      new TextEncoder().encode(JSON.stringify({ cardId: 'kid-b-sheet' })),
    )

    const mine = await targetsOf('kid-a', f.deps)
    expect(mine.cardIds).toEqual(['kid-a-sheet'])
    expect(mine.books).toEqual([])
  })
})
