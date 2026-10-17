/**
 * card-source.test.ts —— 示例卡垫在底下那一层，钉住四件事
 *
 * 1. **运行期优先**：同一条路径两边都有时，读到的是家长自己那一份
 *    （"换一版"之后自己那一片里有 r2，示例还停在 r1）。
 * 2. **只对 `cards/` 生效**：书与档案各有各的收口函数（`resolveBook` / `listChildren`），
 *    这一层再开一个入口就是同一份字节有两条路。
 * 3. **写与删永远落在自己那一片**，示例那份一个字节都不动
 *    （"删除看起来成功、其实没删"是这一层唯一危险的形状）。
 * 4. ★ **真仓库里那两张卡是通的**——这一条是集成判据，不是形状判据：
 *    它按**生产上那条路**拼出 store（`createUserStore` = 作用域 + 示例垫底），
 *    再走引擎出图前那一步（`store.read(card.reference.path)`，见 `engine/index.ts`）。
 *    "示例卡能不能用"这件事的分水岭正是这一步：列得出来只算看得见，
 *    参考图字节读得到才算能用（做一本书要拿它锁脸）。
 *    ★ 所以它会在"发布目录挪了位置""`latest` 没跟着发""参考图没拷进仓库"
 *    这三种情形下变红——而那三种都是看得见摸不着的样子。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createUserStore } from './asset-scope.ts'
import { withDemoCards } from './card-source.ts'
import { listCardItems } from './cards-list.ts'
import { listChildItems } from './children-list.ts'
import { digest } from './engine/digest.ts'
import { createCardStore, createMemoryStore } from './engine/index.ts'

const cleanups: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'card-source-'))
  cleanups.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** 一个假的"示例层"：往内存 store 里写一条卡路径 */
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('withDemoCards · 两个来源谁优先', () => {
  it('同一条路径两边都有时读自己那一份', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    await mine.put({ path: 'cards/r1/x.json', bytes: bytesOf('我的'), mime: 'application/json' })
    await demo.put({ path: 'cards/r1/x.json', bytes: bytesOf('示例'), mime: 'application/json' })

    const store = await withDemoCards(mine, demo)
    expect(new TextDecoder().decode((await store.read('cards/r1/x.json')) ?? bytesOf(''))).toBe(
      '我的',
    )
  })

  it('自己那一片没有时才落回示例', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    await demo.put({ path: 'cards/demo1/latest', bytes: bytesOf('1'), mime: 'text/plain' })

    const store = await withDemoCards(mine, demo)
    expect(await store.exists('cards/demo1/latest')).toBe(true)
    expect(new TextDecoder().decode((await store.read('cards/demo1/latest')) ?? bytesOf(''))).toBe(
      '1',
    )
  })

  it('★ 只对 cards/ 生效：示例那本**书**不该从这条路读得到', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    await demo.put({ path: 'books/b1/book.json', bytes: bytesOf('{}'), mime: 'application/json' })
    await demo.put({ path: 'children/x.json', bytes: bytesOf('{}'), mime: 'application/json' })

    const store = await withDemoCards(mine, demo)
    expect(await store.read('books/b1/book.json')).toBe(null)
    expect(await store.read('children/x.json')).toBe(null)
    // ★ 前缀边界：`cardsfoo/` 不是 `cards/` 那一族
    await demo.put({ path: 'cardsfoo/y', bytes: bytesOf('x'), mime: 'text/plain' })
    expect(await store.read('cardsfoo/y')).toBe(null)
    expect(await store.list('books/')).toEqual([])
  })

  it('list 是并集（"有哪些卡"这件事必须看得见两边），且不带上别的族', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    await mine.putJson({ path: 'cards/mine/r1.a.json', value: { cardId: 'mine' } })
    await demo.putJson({ path: 'cards/demo1/r1.b.json', value: { cardId: 'demo1' } })
    await demo.put({ path: 'books/b1/book.json', bytes: bytesOf('{}'), mime: 'application/json' })

    const store = await withDemoCards(mine, demo)
    expect(await store.list('cards/')).toEqual(['cards/demo1/r1.b.json', 'cards/mine/r1.a.json'])
    // `load()` 传的是不带斜杠的那个前缀（`CARDS_PREFIX`），所以它也得算
    expect(await store.list('cards')).toHaveLength(2)
  })
})

describe('withDemoCards · 写与删只落在自己那一片', () => {
  it('put / putJson 不会写进示例层', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    await demo.put({ path: 'cards/demo1/latest', bytes: bytesOf('1'), mime: 'text/plain' })

    const store = await withDemoCards(mine, demo)
    await store.put({ path: 'cards/demo1/latest', bytes: bytesOf('2'), mime: 'text/plain' })
    await store.putJson({ path: 'cards/demo1/r2.c.json', value: { cardId: 'demo1' } })

    expect(demo.all()).toEqual(['cards/demo1/latest'])
    // 写完之后读到的是新的那一份（自己那一片优先）
    expect(new TextDecoder().decode((await store.read('cards/demo1/latest')) ?? bytesOf(''))).toBe(
      '2',
    )
  })

  it('★ 删一张示例卡：删掉的是自己那一片里的同名文件，示例那份还在（所以报数不能当"删干净了"看）', async () => {
    const mine = createMemoryStore()
    const demo = createMemoryStore()
    // 自己那一片里有一张卡，示例层里也有一张同名卡——只有前者该被删掉
    await mine.putJson({ path: 'cards/xiaoman-r1/r2.d.json', value: { cardId: 'xiaoman-r1' } })
    await demo.putJson({ path: 'cards/xiaoman-r1/r1.e.json', value: { cardId: 'xiaoman-r1' } })

    const store = await withDemoCards(mine, demo)
    expect(await store.deletePrefix('cards/xiaoman-r1/')).toBe(1)
    expect(demo.all()).toContain('cards/xiaoman-r1/r1.e.json')
    expect(await store.read('cards/xiaoman-r1/r1.e.json')).not.toBe(null)
  })
})

describe('★ 真仓库里那两张示例卡（集成）', () => {
  it('空账号里也列得出小满与小宇，而且"有档案、有形象"两样都在', async () => {
    const root = await tempRoot()
    const items = await listChildItems(root)
    const demo = items.filter((item) => item.source === 'demo')

    expect(demo.map((item) => item.profile.childId).sort()).toEqual(['xiaoman', 'xiaoyu'])
    for (const item of demo) {
      expect(item.card).not.toBe(null)
      // 图走 `/api/assets`（与运行期的卡同一条路），而不是 public 下的静态地址
      expect(item.card?.referenceUrl).toMatch(
        /^\/api\/assets\/cards\/[a-z]+-r1\/ref\.[0-9a-f]+\.jpg$/,
      )
    }
  })

  it('★★ 走生产那条路把参考图字节读出来（出图前那一步，见 engine/index.ts）', async () => {
    const root = await tempRoot()
    // 与路由一模一样：作用域 store（`u/1/` 是空的）+ 示例垫底
    const store = await createUserStore(root, '1')
    const card = await createCardStore(store).latest('xiaoman-r1')
    expect(card).not.toBe(null)

    // ★ 这一行就是引擎出图前那一步：没有示例垫底，它拿到的是 null，
    //   而症状是"示例小主角选得中、一点生成就说找不到参考图"
    const bytes = await store.read(card?.reference.path ?? '')
    expect(bytes).not.toBe(null)
    expect(bytes?.byteLength).toBe(card?.reference.bytes)
    // 参考图是内容寻址的：盘上那份字节算出来的指纹要与卡里记的一致
    expect(digest(bytes ?? bytesOf(''))).toBe(card?.reference.digest)
  })

  it('示例卡也出现在 listCardItems 里（空账号的第一屏）', async () => {
    const root = await tempRoot()
    const cards = await listCardItems(root)
    expect(cards.map((card) => card.cardId).sort()).toEqual(['xiaoman-r1', 'xiaoyu-r1'])
    expect(cards.every((card) => card.photoDeleted === false)).toBe(true)
  })
})
