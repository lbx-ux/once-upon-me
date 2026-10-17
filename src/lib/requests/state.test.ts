/**
 * requests/state.test.ts —— 权限申请那一行的读法
 *
 * ★ 这一组盯的是**读不出来的那一侧**，因为这一屏上"读不出来"与"没有"长得一样：
 *   一条申请少了 `current`（他手里现有的权限），管理页上「他已有的」那一格
 *   会显示成空——而站长会照着它以为这次批准是从零开始的。
 *   所以判据是"这一行**被拒了**"，不是"某一格显示得对不对"。
 */

import { describe, expect, it } from 'vitest'

import { parseMine, parseRequestList, parseRequestRow, wantsList } from './state.ts'

/** 一条完整的、服务端真会回的行。每一处断言都从它出发做减法 */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: '7',
    userId: '3',
    account: '13788880001',
    nickname: '小满',
    phone: '13788880001',
    current: { text: true, image: false, vision: false, speech: false },
    wants: { text: false, image: true, vision: false, speech: false },
    note: '想做一本有插画的书',
    status: 'PENDING',
    createdAt: '2026-10-17T14:20:00',
    decidedAt: null,
    ...overrides,
  }
}

describe('parseRequestRow', () => {
  it('一条完整的行读得回来，而且 current 与 wants 是**两个**字段', () => {
    const parsed = parseRequestRow(row())
    expect(parsed).not.toBeNull()
    // ★ 这条是本组的要害：两格读的必须是不同的东西。
    //   第一版界面上两格都读了 `wants`，于是"他已有的"永远等于"这次要的"——
    //   而那样一个界面看起来完全正常，只是把站长的判断带偏了。
    expect(parsed?.current.image).toBe(false)
    expect(parsed?.wants.image).toBe(true)
    expect(parsed?.current.text).toBe(true)
    expect(parsed?.wants.text).toBe(false)
  })

  it('少了 current 就整条不认——不是"那一格空着"', () => {
    const withoutCurrent = row()
    delete withoutCurrent['current']
    expect(parseRequestRow(withoutCurrent)).toBeNull()
  })

  it('current 里少一个键也整条不认', () => {
    expect(
      parseRequestRow(row({ current: { text: true, image: false, vision: false } })),
    ).toBeNull()
  })

  it('认不出的状态整条不认（`PENDINGD` 这种顺手打错的）', () => {
    expect(parseRequestRow(row({ status: 'PENDINGD' }))).toBeNull()
  })

  it('没有账号就整条不认：看不出是谁的申请正是这一整个功能要补的那一格', () => {
    expect(parseRequestRow(row({ account: '' }))).toBeNull()
    const noAccount = row()
    delete noAccount['account']
    expect(parseRequestRow(noAccount)).toBeNull()
  })

  it('没有编号也整条不认：批它的时候要拿这个号去拼 URL', () => {
    expect(parseRequestRow(row({ requestId: '' }))).toBeNull()
  })

  it('没写说明是 null（不是空串）：界面上"没写"与"写了空"要分得开', () => {
    expect(parseRequestRow(row({ note: null }))?.note).toBeNull()
    expect(parseRequestRow(row({ note: '' }))?.note).toBeNull()
    expect(parseRequestRow(row({ note: '想画插画' }))?.note).toBe('想画插画')
  })

  it('还没处理的没有处理时间，那不是错误', () => {
    const parsed = parseRequestRow(row())
    expect(parsed?.decidedAt).toBeNull()
    expect(parseRequestRow(row({ decidedAt: '2026-10-17T15:00:00' }))?.decidedAt).toBe(
      '2026-10-17T15:00:00',
    )
  })
})

describe('parseRequestList', () => {
  it('空列表是空列表（没有申请过是正常状态，不是错误）', () => {
    expect(parseRequestList([])).toEqual([])
  })

  it('★ 其中**任意一条**形状不对就整份拒绝，不是"跳过那一条"', () => {
    // 跳过一条的后果不是"少一行"，是"站长以为他把这一列都看完了"——
    // 而那条被跳过的申请还挂在待处理里，等着人批
    const list = [row({ requestId: '1' }), row({ requestId: '2', account: '' })]
    expect(parseRequestList(list)).toBeNull()
  })

  it('不是数组就拒绝（后端回了 `{"requests": […]}` 这种包了一层的时候）', () => {
    expect(parseRequestList({ requests: [] })).toBeNull()
    expect(parseRequestList(null)).toBeNull()
  })
})

describe('parseMine', () => {
  it('`{"request": null}` 读成 null —— 没申请过是正常状态，不是错误', () => {
    expect(parseMine({ request: null })).toBeNull()
  })

  it('有一条就读得回来', () => {
    expect(parseMine({ request: row() })?.requestId).toBe('7')
  })

  it('形状不对的响应读成 null 之前，调用方还要能分辨——所以这里回 null 而**不是**抛', () => {
    // ★ `fetchMine` 那一侧靠 `verdict.ok` 分"没申请过"与"没查到"。
    //   这里若抛出去，那个区分就没了：一次读不到会显示成"你还没申请过"，
    //   而那句话会让人再提一次——正是这一整个功能要防的那种堆积
    expect(parseMine({ request: { requestId: '7' } })).toBeNull()
    expect(parseMine('不是对象')).toBeNull()
  })
})

describe('wantsList', () => {
  const labels = [
    { key: 'text' as const, label: '文字' },
    { key: 'image' as const, label: '图像' },
    { key: 'vision' as const, label: '视觉' },
    { key: 'speech' as const, label: '语音' },
  ]

  it('只列开着的那几项，且按**传进来的次序**（两端要一致）', () => {
    expect(wantsList({ text: true, image: false, vision: false, speech: true }, labels)).toEqual([
      '文字',
      '语音',
    ])
  })

  it('一项都没开就是空的——调用方自己决定说哪句话', () => {
    expect(wantsList({ text: false, image: false, vision: false, speech: false }, labels)).toEqual(
      [],
    )
  })
})
