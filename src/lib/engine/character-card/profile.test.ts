/**
 * profile.test.ts —— 档案那一层（工单 03）
 *
 * 这一层是"他是谁"的**唯一**出处（`kid-names.ts` 的文件头写着它会被替换掉，
 * 而不是再长第二份真相）。所以这里盯的是四件事：
 *
 * 1. **childId 会被当成路径的一段用**——界面上它来自 `/character/[childId]`
 *    那一段 URL。目录穿越要挡在数据层，见下面那条测试。
 * 2. **从磁盘读回来的那一份必须全函数**：半截 JSON、人手改过、旧 schema，
 *    解析不出来就跳过这一份，不是让整页崩掉（第一版就是在这里炸的）。
 * 3. **`createdAt` 不可被改名改写**：档案没有版本，但"什么时候建的"是事实。
 * 4. **字段表来自领域层**，不在这里另写一份——名字/读音/年龄档/他喜欢什么，
 *    表单收的、引擎认的、档案存的必须是同一组（见 profile.ts 文件头）。
 */

import { describe, expect, it } from 'vitest'

import { buildChildRecord, displayNameOf, toChildRecord, validateChildRecord } from './profile.ts'
import { createProfileStore } from './profile-store.ts'
import { createMemoryStore } from '../providers/stores.ts'

function base() {
  return {
    childId: 'xiaoyu',
    name: '小宇',
    nameReading: 'yǔ',
    ageBand: '4-6' as const,
    lookTags: ['短发'],
    interestTags: ['云'],
    createdAt: 1_700_000_000_000,
  }
}

describe('buildChildRecord · 不合格的进不来', () => {
  it('名字/读音/年龄档三样都要在，问题清单说的是人话', () => {
    expect(validateChildRecord(buildChildRecord(base()))).toEqual([])
    expect(() => buildChildRecord({ ...base(), name: '  ' })).toThrow(/名字是空的/)
    expect(() => buildChildRecord({ ...base(), nameReading: '' })).toThrow(/读音是空的/)
    expect(() => buildChildRecord({ ...base(), ageBand: '5-7' as unknown as '4-6' })).toThrow(
      /年龄档要是/,
    )
  })

  it('★ childId 是路径的一段：`..` 与斜杠一律不收', () => {
    // 这些串会被拼进 `children/<childId>.json`。挡在这里而不是路由层——
    // 路由那层只转发字符串，它不知道这个值要拿去当路径
    for (const bad of ['../../etc/passwd', 'a/b', 'a\\b', '..', '', 'a'.repeat(65), '小宇']) {
      expect(() => buildChildRecord({ ...base(), childId: bad })).toThrow(/childId/)
    }
    // 表单生成的形状与两个演示孩子的形状都要收得下
    for (const ok of ['kid-8f3a1c', 'xiaoyu', 'xiaoman', 'kid-a_b-c']) {
      expect(validateChildRecord(buildChildRecord({ ...base(), childId: ok }))).toEqual([])
    }
  })

  it('前后空白被剪掉、空标签被丢掉（不是留着让两个"小宇"长成两份档案）', () => {
    const record = buildChildRecord({
      ...base(),
      name: ' 小宇 ',
      nameReading: ' yǔ ',
      interestTags: [' 云 ', '', '  '],
    })
    expect(record.name).toBe('小宇')
    expect(record.nameReading).toBe('yǔ')
    expect(record.interestTags).toEqual(['云'])
  })

  it('updatedAt 缺省等于 createdAt（新建就是没改过）', () => {
    expect(buildChildRecord(base()).updatedAt).toBe(base().createdAt)
    expect(buildChildRecord({ ...base(), updatedAt: 42 }).updatedAt).toBe(42)
  })

  it('抛的是 EngineError 那条码：`userFailureOf` 按 code 分流文案与状态码', () => {
    // 一个"长得像但不是 EngineError"的错误会被规约成 provider-call-failed，
    // 于是"名字是空的"会回 502（平台故障）。工单 02 在 reference-invalid 上踩过一次
    try {
      buildChildRecord({ ...base(), name: '' })
      expect.unreachable('应当抛')
    } catch (err) {
      expect((err as { code?: string }).code).toBe('profile-invalid')
    }
  })
})

describe('toChildRecord · 从磁盘读回来的那一份是全函数', () => {
  it('缺项、类型不对、根本不是对象 —— 一律回 null，不抛', () => {
    for (const bad of [
      null,
      undefined,
      42,
      '不是对象',
      [],
      {},
      { childId: 'broken' },
      { ...base(), ageBand: undefined },
      { ...base(), nameReading: 123 },
    ]) {
      expect(toChildRecord(bad)).toBeNull()
    }
  })

  it('★ 标签缺了或不是数组：不算不合格，但补成数组（类型上写着 string[]，不许说谎）', () => {
    // 直接写一份"没有标签"的 JSON，比从 base() 里删两个键更直白（也让断言读得出在测什么）
    const record = toChildRecord({
      childId: 'xiaoyu',
      name: '小宇',
      nameReading: 'yǔ',
      ageBand: '4-6',
      createdAt: 1_700_000_000_000,
    })
    expect(record?.lookTags).toEqual([])
    expect(record?.interestTags).toEqual([])

    const wrongType = toChildRecord({ ...base(), lookTags: '短发' })
    expect(wrongType?.lookTags).toEqual([])
  })

  it('时间不是数就归 0，而不是 undefined 流进界面（`第 undefined 天`）', () => {
    const record = toChildRecord({ ...base(), createdAt: '昨天', updatedAt: null })
    expect(record?.createdAt).toBe(0)
    // 没写 updatedAt = 从没改过 ⇒ 与 createdAt 同值（两边同一条规则，见 freshUpdate）
    expect(record?.updatedAt).toBe(0)
  })

  it('★ 写下去再读回来必须相等 —— 同一组字段两边不许各判各的', () => {
    // 这条是被一个真 bug 逼出来的：build 把缺省的 updatedAt 当成 createdAt，
    // toChildRecord 把它当成 0，于是"存了再读"的记录不相等
    expect(toChildRecord(buildChildRecord(base()))).toEqual(buildChildRecord(base()))
    expect(toChildRecord(buildChildRecord({ ...base(), updatedAt: 42 }))).toEqual(
      buildChildRecord({ ...base(), updatedAt: 42 }),
    )
  })

  it('合法的原样读回来', () => {
    expect(toChildRecord(base())).toEqual(buildChildRecord(base()))
  })
})

describe('displayNameOf · 读不到就读不到', () => {
  it('有档案就是「名字 · 读音」', () => {
    expect(displayNameOf(buildChildRecord(base()), 'xiaoyu')).toBe('小宇 · yǔ')
  })

  it('没有档案退回给的退路，**不编一个名字**', () => {
    expect(displayNameOf(null, 'kid-8f3a1c')).toBe('kid-8f3a1c')
  })
})

describe('profile-store · 一个孩子一个文件', () => {
  it('存了能读回来，list 排序稳定', async () => {
    const store = createProfileStore(createMemoryStore())
    await store.save({ ...base(), childId: 'kid-b' })
    await store.save({ ...base(), childId: 'kid-a', name: '小满' })

    expect((await store.load('kid-a'))?.name).toBe('小满')
    expect((await store.list()).map((p) => p.childId)).toEqual(['kid-a', 'kid-b'])
  })

  it('空目录 = 空表，不是错误', async () => {
    const store = createProfileStore(createMemoryStore())
    expect(await store.list()).toEqual([])
    expect(await store.load('xiaoyu')).toBeNull()
  })

  it('★ 改名不改 createdAt —— 传进来的 createdAt 在已存在的档案上被忽略', async () => {
    const store = createProfileStore(createMemoryStore())
    await store.save({ ...base(), createdAt: 1000 })
    const renamed = await store.save({
      ...base(),
      name: '小宇宙',
      createdAt: 9999,
      updatedAt: 9999,
    })
    expect(renamed.createdAt).toBe(1000)
    expect(renamed.updatedAt).toBe(9999)
    expect((await store.load('xiaoyu'))?.name).toBe('小宇宙')
  })

  it('★ load 也挡目录穿越：界面上那个 childId 直接来自 URL', async () => {
    const store = createProfileStore(createMemoryStore())
    await expect(store.load('../../etc/passwd')).rejects.toMatchObject({
      code: 'profile-invalid',
    })
    await expect(store.delete('a/b')).rejects.toMatchObject({ code: 'profile-invalid' })
  })

  it('形状不对的档案在 list 里被跳过，不是让整页崩掉', async () => {
    const mem = createMemoryStore()
    await mem.putJson({ path: 'children/broken.json', value: { childId: 'broken' } })
    await mem.putJson({ path: 'children/good.json', value: buildChildRecord(base()) })
    const store = createProfileStore(mem)
    expect((await store.list()).map((p) => p.childId)).toEqual(['xiaoyu'])
  })

  it('delete 返回删掉的条数（删除凭据要报数）', async () => {
    const store = createProfileStore(createMemoryStore())
    await store.save(base())
    expect(await store.delete('xiaoyu')).toBe(1)
    expect(await store.delete('xiaoyu')).toBe(0)
  })
})
