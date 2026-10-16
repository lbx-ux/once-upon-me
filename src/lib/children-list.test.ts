/**
 * children-list.test.ts —— 那道**窄投影**（`listChildPicker`）漏了什么
 *
 * ★ 这个文件只钉一条，但它是那条报障在**界面这条路上**最后的漏点：
 *   「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」。
 *
 *   那条链上有四节，前三节当时都补了（`toBookBody` 送、`parseCreateBody` 收、
 *   引擎把它变成逐页 prompt 里那个称呼），而**第四节没补**：
 *   `/home` 那张卡上的孩子是从 `listChildPicker` 反查来的，
 *   而这道投影只挑 childId/name/nameReading/ageBand/lookTags/interestTags
 *   —— 性别在**进 `/create` 之前**就掉了。于是三节补好的管道里流过一个
 *   `undefined`，症状与没修一模一样。
 *
 * ★ 判据为什么选"投影里有没有这个值"而不是"页面上选得中"：
 *   点得中只证明 React 状态，而这一栏的消费者在服务端的提示词里。
 *   上一刀（`probe-gender-roundtrip.mjs`）已经证明了档案那条往返是通的；
 *   这里要证的是**它有没有被投影带出来**——两件事，中间隔着一次 `.map()`。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listChildPicker } from './children-list.ts'
import { buildChildRecord } from './engine/character-card/profile.ts'

const cleanups: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'children-list-'))
  cleanups.push(dir)
  return dir
}

/** 往一个资产根里写一条运行期档案（走引擎那条路，不手拼 JSON） */
async function seed(root: string, childId: string, gender?: 'boy' | 'girl') {
  await mkdir(join(root, 'children'), { recursive: true })
  const record = buildChildRecord({
    childId,
    name: '性别探针',
    nameReading: 'tàn zhēn',
    ageBand: '4-6',
    lookTags: [],
    interestTags: [],
    createdAt: 0,
    ...(gender ? { gender } : {}),
  })
  await writeFile(join(root, 'children', `${childId}.json`), JSON.stringify(record), 'utf8')
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('listChildPicker 这道窄投影', () => {
  it('★ 性别要过这道关口（它就是"在 /home 选了男孩、生成出来有男有女"的那一节）', async () => {
    const root = await tempRoot()
    await seed(root, 'kid-boy1', 'boy')
    const items = await listChildPicker(root)
    const mine = items.find((item) => item.childId === 'kid-boy1')
    expect(mine?.gender).toBe('boy')
  })

  it('★ 没这一栏的档案（示例孩子 / 老档案）：投影里**不出现**这个键，不是 undefined', async () => {
    const root = await tempRoot()
    await seed(root, 'kid-none')
    const items = await listChildPicker(root)
    const mine = items.find((item) => item.childId === 'kid-none')
    expect(mine).toBeDefined()
    // 带一个 undefined 下去，"没选"与"选了空"就分不出来——而下游正是按这个分辨的
    expect(mine && 'gender' in mine).toBe(false)
  })

  it('两种性别都过得去（不是只有男孩那条路能通）', async () => {
    const root = await tempRoot()
    await seed(root, 'kid-girl', 'girl')
    const items = await listChildPicker(root)
    expect(items.find((item) => item.childId === 'kid-girl')?.gender).toBe('girl')
  })
})
