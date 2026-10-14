/**
 * kid-names.test.ts —— 名字那一层**读不到时不许把页面带崩**
 *
 * ★ 为什么单独测一个"读个小文件"：这一屏现在显示的名字（小宇 / 小满）**只存在于
 *   `kids.json`**，而它是演示生成器的副产物——新检出的仓库、清过的 `.out/`、
 *   或者家长运行时新建的卡，都没有它。那条退路必须是测出来的，不是"应该会兜住"。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadKidNames } from './kid-names.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kids-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeKids(text: string): Promise<void> {
  await writeFile(join(root, 'kids.json'), text, 'utf8')
}

describe('loadKidNames', () => {
  it('文件根本不存在 → 空表（这是新资产根的常态，不是错误）', async () => {
    expect(await loadKidNames(root)).toEqual({})
  })

  it('半截 JSON → 空表，不抛', async () => {
    await writeKids('[{"cardId":"a-r1","name":')
    expect(await loadKidNames(root)).toEqual({})
  })

  it('不是数组（有人手改成了对象）→ 空表', async () => {
    await writeKids('{"cardId":"a-r1"}')
    expect(await loadKidNames(root)).toEqual({})
  })

  it('一条完整的读出来，缺 name 或缺 cardId 的那条丢掉', async () => {
    await writeKids(
      JSON.stringify([
        { cardId: 'xiaoyu-r1', childId: 'xiaoyu', name: '小宇', reading: 'yǔ', outfit: '芥黄短袖' },
        { cardId: 'kid-x1', childId: 'kid-x1' }, // 没有名字
        { name: '无名氏' }, // 没有 cardId，挂不到任何卡上
        { cardId: 'kid-y1', name: '   ' }, // 空白名字
      ]),
    )
    const names = await loadKidNames(root)
    expect(Object.keys(names)).toEqual(['xiaoyu-r1'])
    expect(names['xiaoyu-r1']).toEqual({ name: '小宇', reading: 'yǔ', outfit: '芥黄短袖' })
  })

  it('只有名字时也成立：读音与常服是可选的，缺了就不该出现空键', async () => {
    await writeKids(JSON.stringify([{ cardId: 'a-r1', name: '阿和' }]))
    expect(await loadKidNames(root)).toEqual({ 'a-r1': { name: '阿和' } })
  })
})
