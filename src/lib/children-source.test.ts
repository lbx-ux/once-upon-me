/**
 * children-source.test.ts —— 「两个来源、一个函数」那条查找顺序（工单 03）
 *
 * 这个文件里最要紧的一条是示例档案确实在仓库里。
 *   它不是"顺手看一眼"：验收写着"两个示例角色的资产随仓库发布、断网可用"（ADR-0003），
 *   而这一条最容易坏的方式是安静地坏——本机的 `.out/web` 里有一份副本，
 *   于是所有页面都正常，只有评委那台只有 `public/` 的机器上列表是空的。
 *   （`book-source.ts` 的 `demoAssetPathFor` 那段注释记的是同一类事故。）
 *
 * 其余三条盯的是顺序：自己的在前、运行期赢同名、childId 不合法时不抛。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { childProfileOf, isDemoChildId, listChildren } from './children-source.ts'
import { buildChildRecord } from './engine/character-card/profile.ts'

const cleanups: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'children-source-'))
  cleanups.push(dir)
  return dir
}

/** 往一个资产根里写一条运行期档案（走引擎那条路，不手拼 JSON） */
async function seed(root: string, childId: string, name: string, createdAt: number) {
  await mkdir(join(root, 'children'), { recursive: true })
  const record = buildChildRecord({
    childId,
    name,
    nameReading: 'yǔ',
    ageBand: '4-6',
    lookTags: [],
    interestTags: [],
    createdAt,
  })
  await writeFile(join(root, 'children', `${childId}.json`), JSON.stringify(record), 'utf8')
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('示例档案随仓库发布（ADR-0003 那一条）', () => {
  it('两个示例孩子读得到，名字与读音都在', async () => {
    const all = await listChildren(await tempRoot())
    const demo = all.filter((item) => item.source === 'demo')
    expect(demo.map((item) => item.profile.childId).sort()).toEqual(['xiaoman', 'xiaoyu'])
    expect(demo.map((item) => `${item.profile.name} · ${item.profile.nameReading}`).sort()).toEqual(
      ['小宇 · yǔ', '小满 · mǎn'],
    )
  })
})

describe('两个来源的顺序与优先级', () => {
  it('★ 自己的在前（新的在前），示例在后——2026-10-16 第 23 刀翻过来的', async () => {
    const root = await tempRoot()
    await seed(root, 'kid-old', '阿早', 1000)
    await seed(root, 'kid-new', '阿新', 2000)

    const all = await listChildren(root)
    // 用户原话："用户生成的角色要放到默认角色的前面"——卡片墙第一眼要看的是"我的孩子"，
    // 示例是"先看看效果"的东西。★ 断言的是整串，所以顺序再被谁翻一次会红在这里。
    expect(all.map((item) => item.profile.childId)).toEqual([
      'kid-new',
      'kid-old',
      'xiaoman',
      'xiaoyu',
    ])
  })

  it('★ 同 childId 时运行期那份赢：本机常常既有一份示例、又有一份家长自己改过名的', async () => {
    const root = await tempRoot()
    await seed(root, 'xiaoyu', '小宇改过名', 5000)
    const found = await childProfileOf('xiaoyu', root)
    expect(found?.source).toBe('runtime')
    expect(found?.profile.name).toBe('小宇改过名')
  })

  it('读不到的孩子回 null，不抛——childId 是 URL 上的一段，那是用户输入', async () => {
    const root = await tempRoot()
    expect(await childProfileOf('meiyou-zhe-ge-hai-zi', root)).toBeNull()
    // 这一条同时是目录穿越的那道闸：数据层挡不住，这里就会抛出去变成 500 页
    expect(await childProfileOf('../../etc/passwd', root)).toBeNull()
  })

  it('运行期目录里有一团糟的文件时，其余孩子照样列出来', async () => {
    const root = await tempRoot()
    await seed(root, 'kid-ok', '阿好', 1000)
    await mkdir(join(root, 'children'), { recursive: true })
    await writeFile(join(root, 'children', 'half.json'), '{"childId":"half"', 'utf8')
    await writeFile(join(root, 'children', 'empty-shape.json'), '{}', 'utf8')

    const all = await listChildren(root)
    expect(
      all.filter((item) => item.source === 'runtime').map((item) => item.profile.childId),
    ).toEqual(['kid-ok'])
  })
})

/**
 * 这一组是删除那条路的前置判据（工单 03 第三刀）。
 *
 * 示例孩子的档案在 `public/demo/` 里，那是仓库内容，运行期删不掉。
 * 于是"删了他"这件事有两种结局，都很坏：
 *   - 只删掉他名下的运行期卡 → 档案下一次从 `public/` 回来，界面上是
 *     "这个孩子回来了，但形象没了"；
 *   - 连 `public/` 一起动 → 动的是仓库。
 * 所以删除要在动手之前认出这类孩子。判据必须比"当前这份档案的来源"更强：
 * 本机常常既有示例的一份、又有家长覆盖的一份，而覆盖的那份删掉之后，
 * 露出来的仍然是示例那份——症状与第一条一模一样。
 */
describe('哪些 id 是示例孩子（删除要据此拒绝）', () => {
  it('示例的两个是，自己建的不是', async () => {
    expect(await isDemoChildId('xiaoyu')).toBe(true)
    expect(await isDemoChildId('xiaoman')).toBe(true)
    expect(await isDemoChildId('kid-abc123')).toBe(false)
  })

  it('★ 就算运行期覆盖过一份同 id 的档案例外一样拒绝（覆盖删掉会露出示例那份）', async () => {
    const root = await tempRoot()
    await seed(root, 'xiaoyu', '小宇改过名', 5000)
    // 运行期那份确实在，而且 `childProfileOf` 也认它是 runtime
    expect((await childProfileOf('xiaoyu', root))?.source).toBe('runtime')
    // 但它仍然是示例 id —— 删除那条路看的是这个
    expect(await isDemoChildId('xiaoyu')).toBe(true)
  })
})
