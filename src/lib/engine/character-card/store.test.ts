/**
 * store.test.ts —— 角色卡的存取（工单 03 补的）
 *
 * 这个文件在此之前不存在：`store.ts` 里最要紧的一个方法 `deleteChild`
 *   零测试、零调用方（`CharacterWall` 的文件头里写着"拿一个没保障的删除去接
 *   一个家长的'删掉我孩子的样子'，是这一版不能签的"）。
 *   工单 03 要接那条路，所以先把这一层的账还上。
 *
 * 这里盯的是版本纪律，不是 CRUD：
 *   1. 换一版不覆盖旧版（ADR-0007：旧书那些页的出处挂在旧版上）；
 *   2. `latest` 是一个可以指回去的指针，而指回去不动任何一版的内容；
 *   3. `deleteChild` 报数（隐私设计 §九 的删除凭据要"每个存储位置各删了多少条"）。
 */

import { describe, expect, it } from 'vitest'

import { createCardStore } from './store.ts'
import { createMemoryStore } from '../providers/stores.ts'
import type { CharacterAnchor } from '../domain.ts'

const ANCHORS: CharacterAnchor[] = [
  { slot: 'bone', value: '圆脸、颊部饱满、下颌线软' },
  { slot: 'eyes', value: '深棕色圆眼' },
  { slot: 'hair', value: '黑发偏软，左上方翘着一撮' },
  { slot: 'build', value: '头身比约 1:4' },
  // 五条硬锚点缺一条就建不出卡（REQUIRED_SLOTS）。第一版这里少写了 skin，
  // 六个用例当场全红——这条纪律是真的在挡，不是注释
  { slot: 'skin', value: '暖黄偏深的肤色' },
]

const STYLE = { key: 'warm-handdrawn', promptFragment: '水彩', ratio: '1:1' } as const

/** 一张 2×2 的"参考图"。字节不同 → 指纹不同 → 文件名不同，这正是要测的 */
function bytes(seed: number): Uint8Array {
  return new Uint8Array([seed, seed + 1, seed + 2, seed + 3])
}

function makeStore() {
  return createCardStore(createMemoryStore())
}

function input(seed: number) {
  return {
    cardId: 'xiaoyu-r1',
    childId: 'xiaoyu',
    anchors: ANCHORS,
    style: STYLE,
    referenceBytes: bytes(seed),
    referenceMime: 'image/png',
    modelId: 'wan2.7-image',
    promptVersion: 'character-sheet@v1',
    now: 1_700_000_000_000 + seed,
  }
}

describe('换一版 · 只能追加', () => {
  it('第 2 版是新 revision，第 1 版的文件与参考图一个字节都没动', async () => {
    const store = makeStore()
    const { card: v1 } = await store.create(input(1))
    const { card: v2 } = await store.create({
      ...input(2),
      previous: v1,
      suggestion: '眼睛再大一点，头发短一些',
    })

    expect(v2.revision).toBe(2)
    expect(v2.provenance.cardRevision).toBe(2)
    // 参考图换了内容 → 换文件名（内容寻址），旧图还在
    expect(v2.reference.path).not.toBe(v1.reference.path)
    expect(await store.load('xiaoyu-r1', 1)).toMatchObject({
      revision: 1,
      reference: { path: v1.reference.path, digest: v1.reference.digest },
    })
    // 锚点不变：那句话进的是 provenance，不是 anchors（card.ts 文件头的不变式）
    expect(v2.anchors).toEqual(v1.anchors)
  })

  it('★ 家长那句「想改哪里」进 provenance.suggestion，且**只有换一版才有**', async () => {
    const store = makeStore()
    const { card: v1 } = await store.create(input(1))
    expect(v1.provenance.suggestion).toBeUndefined()

    const { card: v2 } = await store.create({
      ...input(2),
      previous: v1,
      suggestion: '眼睛再大一点',
    })
    expect(v2.provenance.suggestion).toBe('眼睛再大一点')
  })
})

describe('revisions · 一张卡走过哪些版本', () => {
  it('按 revision 升序，三版都在', async () => {
    const store = makeStore()
    let card = (await store.create(input(1))).card
    card = (await store.create({ ...input(2), previous: card, suggestion: 'b' })).card
    await store.create({ ...input(3), previous: card, suggestion: 'c' })

    expect((await store.revisions('xiaoyu-r1')).map((c) => c.revision)).toEqual([1, 2, 3])
    expect((await store.revisions('meiyou-zhe-zhang')).length).toBe(0)
  })
})

describe('setLatest · 切回旧版只动那个指针', () => {
  it('指回去之后 latest 是旧版，而新版文件仍在、内容没变', async () => {
    const store = makeStore()
    const { card: v1 } = await store.create(input(1))
    const { card: v2 } = await store.create({ ...input(2), previous: v1, suggestion: '改一下' })

    await store.setLatest('xiaoyu-r1', 1)
    expect((await store.latest('xiaoyu-r1'))?.revision).toBe(1)

    const stillThere = await store.load('xiaoyu-r1', 2)
    expect(stillThere?.reference.path).toBe(v2.reference.path)
    expect(stillThere?.provenance.suggestion).toBe('改一下')

    // 再切回来也要能
    await store.setLatest('xiaoyu-r1', 2)
    expect((await store.latest('xiaoyu-r1'))?.revision).toBe(2)
  })

  it('指到一版没有的 → 抛，而不是写一个指不到东西的指针', async () => {
    const store = makeStore()
    await store.create(input(1))
    await expect(store.setLatest('xiaoyu-r1', 9)).rejects.toMatchObject({
      code: 'card-not-found',
    })
    // 指针没被写坏
    expect((await store.latest('xiaoyu-r1'))?.revision).toBe(1)
  })
})

/**
 * 这一组是被一个真 bug 逼出来的：切回旧版之后，`latest` 文件里明明写着 1，
 *   而列表页还说"现在这一版是第 2 版"——`summaries()` 当时用的是
 *   "扫目录取最大 revision"，它在"切回旧版"这个动作出现之前与指针永远一致，
 *   所以静态读代码看不出来，写这一组测试之前也一直是绿的。
 *   发现它靠的是在浏览器里点了一遍。
 */
describe('summaries · "现在这张"是指针说的，不是 revision 最大那张', () => {
  it('★ 切回第 1 版之后，summaries 报的就是第 1 版', async () => {
    const store = makeStore()
    const { card: v1 } = await store.create(input(1))
    await store.create({ ...input(2), previous: v1, suggestion: 'b' })

    expect((await store.summaries())[0]?.revision).toBe(2)
    await store.setLatest('xiaoyu-r1', 1)
    expect((await store.summaries())[0]?.revision).toBe(1)
    // 报出来的参考图也要跟着走，否则界面显示的是"第 1 版"配上一张第 2 版的图
    expect((await store.summaries())[0]?.referencePath).toBe(v1.reference.path)
  })

  it('指针缺了或被手写坏 → 退回 revision 最大那一版，不是"这个孩子没有形象"', async () => {
    const mem = createMemoryStore()
    const store = createCardStore(mem)
    const { card: v1 } = await store.create(input(1))
    await store.create({ ...input(2), previous: v1, suggestion: 'b' })

    await mem.put({ path: 'cards/xiaoyu-r1/latest', bytes: new Uint8Array(), mime: 'text/plain' })
    expect((await store.summaries())[0]?.revision).toBe(2)

    await mem.put({
      path: 'cards/xiaoyu-r1/latest',
      bytes: new TextEncoder().encode('99'),
      mime: 'text/plain',
    })
    expect((await store.summaries())[0]?.revision).toBe(2)
  })
})

describe('deleteChild · 报数（删除凭据的数据源）', () => {
  it('删掉这个孩子的全部版本与参考图，并报出条数', async () => {
    const store = makeStore()
    const { card: v1 } = await store.create(input(1))
    await store.create({ ...input(2), previous: v1, suggestion: 'b' })

    // 另一个孩子的东西不许被牵连
    await store.create({ ...input(3), cardId: 'xiaoman-r1', childId: 'xiaoman' })

    const deleted = await store.deleteChild('xiaoyu')
    // 两个版本 + 两张参考图 + latest 指针 = 5 个文件
    expect(deleted.cards).toBe(5)
    expect(deleted.bytes).toBeGreaterThan(0)

    expect(await store.latest('xiaoyu-r1')).toBeNull()
    expect((await store.latest('xiaoman-r1'))?.childId).toBe('xiaoman')
  })

  it('删一个不存在的孩子报 0，不报错', async () => {
    const store = makeStore()
    expect(await store.deleteChild('meiyou')).toEqual({ cards: 0, bytes: 0 })
  })
})
