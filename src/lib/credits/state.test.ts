/**
 * credits/state.test.ts —— 额度那几份数据怎么读回来（2026-10-30）
 *
 * 这里从头到尾是同一条判断：**额度是钱，半份比没有更坏。**
 *   · 一份总账里有一笔流水缺了 `delta`，整份拒绝——跳过那一条的症状是
 *     "这个人有一笔流水不见了"，而看的人不会知道少了一笔；
 *   · 一批码里有一张不是字符串，整批拒绝——半批码发下去，另一半人兑不了，
 *     而屏幕上那一批看起来是完整的。
 *
 * 另外两条钉的是**与 Java 逐字一致**的那两处规则（`normalizeCode`、`formatCode`）：
 *   两边不一致的症状是"用户照抄下来的码输进去说不对"，而那是最难查的一种。
 */

import { describe, expect, it } from 'vitest'

import {
  deltaTextOf,
  formatCode,
  normalizeCode,
  parseAdminCreditOverview,
  parseCodeBatchResult,
  parseCreditView,
  parseRedeemOutcome,
  reasonLabelOf,
  yuanOf,
} from './state.ts'

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '17',
  delta: 2,
  reason: 'redeem',
  ref: null,
  note: '一张码',
  createdAt: '2026-10-30T10:00:00+08:00',
  ...over,
})

const view = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  balance: 3,
  entries: [entry()],
  ...over,
})

const batch = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  batch: '2026-11-一班',
  booksPerCode: 2,
  count: 30,
  redeemed: 4,
  createdAt: '2026-10-30T10:00:00+08:00',
  note: '三十个人',
  ...over,
})

const admin = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  totalBalance: 12,
  usersWithCredits: 3,
  codesTotal: 30,
  codesRedeemed: 4,
  ledgerDrift: 0,
  batches: [batch()],
  ...over,
})

describe('parseCreditView · 自己的额度与流水', () => {
  it('齐了就读得出来', () => {
    const parsed = parseCreditView(view())
    expect(parsed?.balance).toBe(3)
    expect(parsed?.entries[0]?.delta).toBe(2)
    expect(parsed?.entries[0]?.reason).toBe('redeem')
    // 没有关联单据时是 `null`，不是空串（空串会被当成"有一个空的 ref"）
    expect(parsed?.entries[0]?.ref).toBeNull()
  })

  it('★ 一笔流水缺了 delta → **整份拒绝**，不是跳过那一笔', () => {
    expect(parseCreditView(view({ entries: [entry({ delta: undefined })] }))).toBeNull()
    // 字符串数字也不算：后端换了序列化方式时，界面该说"读不出来"而不是显示 NaN
    expect(parseCreditView(view({ entries: [entry({ delta: '2' })] }))).toBeNull()
  })

  it('balance 必须是数：缺了 / 是 null / 是字符串都拒绝', () => {
    expect(parseCreditView(view({ balance: undefined }))).toBeNull()
    expect(parseCreditView(view({ balance: null }))).toBeNull()
    expect(parseCreditView(view({ balance: '3' }))).toBeNull()
    // 0 是真的数（额度用完了），不能与"读不出来"混为一谈
    expect(parseCreditView(view({ balance: 0 }))?.balance).toBe(0)
  })

  it('entries 不是数组 → null（不是"没有流水"）', () => {
    expect(parseCreditView(view({ entries: null }))).toBeNull()
    expect(parseCreditView(view({ entries: {} }))).toBeNull()
    expect(parseCreditView(null)).toBeNull()
    expect(parseCreditView(view({ balance: Number.NaN }))).toBeNull()
  })
})

describe('parseAdminCreditOverview · 管理页那一张卡', () => {
  it('齐了就读得出来，对账差也读得出来', () => {
    const parsed = parseAdminCreditOverview(admin({ ledgerDrift: -2 }))
    expect(parsed?.totalBalance).toBe(12)
    expect(parsed?.ledgerDrift).toBe(-2)
    expect(parsed?.batches[0]?.count).toBe(30)
  })

  it('★ 对账差那一格缺了 → 整份拒绝（它不是可选的装饰，是判据）', () => {
    expect(parseAdminCreditOverview(admin({ ledgerDrift: undefined }))).toBeNull()
  })

  it('一个批次认不出 → 整份拒绝', () => {
    expect(parseAdminCreditOverview(admin({ batches: [batch({ batch: '' })] }))).toBeNull()
  })

  it('空表是合法的空表（还没发过码），不是 null', () => {
    const parsed = parseAdminCreditOverview(admin({ batches: [] }))
    expect(parsed?.batches).toEqual([])
  })
})

describe('parseRedeemOutcome · 兑换成功那一条', () => {
  it('三个字段都要，缺一个就整条不认', () => {
    expect(parseRedeemOutcome({ books: 2, balance: 5, codeTail: 'K7QM' })).toEqual({
      books: 2,
      balance: 5,
      codeTail: 'K7QM',
    })
    expect(parseRedeemOutcome({ books: 2, balance: 5 })).toBeNull()
    // 后四位是"这张码是哪一张"的唯一凭据，空串等于没有
    expect(parseRedeemOutcome({ books: 2, balance: 5, codeTail: '' })).toBeNull()
  })

  it('★ 余额以服务端为准：它回什么就是什么（不是 books + 本地那个数）', () => {
    // 这条钉的是组件的写法：它必须用响应里的 balance，而不是自己加
    expect(parseRedeemOutcome({ books: 2, balance: 7, codeTail: 'AAAA' })?.balance).toBe(7)
  })
})

describe('parseCodeBatchResult · 一批明文档', () => {
  it('读得出来，且码原样保留（服务端已经分好组了）', () => {
    const parsed = parseCodeBatchResult({
      batch: '2026-11-一班',
      booksPerCode: 2,
      codes: ['ABCD-EFGH-JKLM-NPQR', '2345-6789-ABCD-EFGH'],
      expiresAt: '2027-10-30T10:00:00+08:00',
    })
    expect(parsed?.codes).toHaveLength(2)
    expect(parsed?.codes[0]).toBe('ABCD-EFGH-JKLM-NPQR')
  })

  it('★ 半批码比没有更坏：有一项不是字符串 → 整批拒绝', () => {
    expect(
      parseCodeBatchResult({
        batch: 'x',
        booksPerCode: 1,
        codes: ['ABCD-EFGH-JKLM-NPQR', null],
      }),
    ).toBeNull()
    expect(
      parseCodeBatchResult({ batch: 'x', booksPerCode: 1, codes: ['ABCD-EFGH-JKLM-NPQR', ''] }),
    ).toBeNull()
  })

  it('不过期的那一批 `expiresAt` 是 null，不是空串', () => {
    const parsed = parseCodeBatchResult({
      batch: 'x',
      booksPerCode: 1,
      codes: ['ABCD-EFGH-JKLM-NPQR'],
      expiresAt: null,
    })
    expect(parsed?.expiresAt).toBeNull()
  })
})

describe('code 的规范形 · 与 Java 的 CodeFactory 逐字同一条规则', () => {
  it('小写、空格、连字符都吃掉', () => {
    expect(normalizeCode('abcd-efgh jklm npqr')).toBe('ABCDEFGHJKLMNPQR')
    // 中文输入法下的全角连字符与全角空格
    expect(normalizeCode('ABCD－EFGH　JKLM NPQR')).toBe('ABCDEFGHJKLMNPQR')
  })

  it('分组只是给人看的：`formatCode(normalizeCode(x)) === formatCode(x)`', () => {
    const raw = 'abcd efgh jklm npqr'
    expect(formatCode(raw)).toBe('ABCD-EFGH-JKLM-NPQR')
    // 拿分组之后的串再走一遍，还是同一串（用户把格式化过的码粘回来是最常见的情形）
    expect(formatCode(formatCode(raw))).toBe('ABCD-EFGH-JKLM-NPQR')
  })

  it('长度不是 16 时原样给干净串，不硬分组', () => {
    // 硬分组会让"少打了一位"看起来像一个完整的码
    expect(formatCode('ABCD-EFGH')).toBe('ABCDEFGH')
    expect(formatCode('')).toBe('')
  })
})

describe('界面上的那几句', () => {
  it('四个 reason 各有一句中文，认不出的**原样显示**（不编一个）', () => {
    expect(reasonLabelOf('grant')).toBe('补发')
    expect(reasonLabelOf('redeem')).toBe('兑换码')
    expect(reasonLabelOf('consume')).toBe('画了一本')
    expect(reasonLabelOf('refund')).toBe('退回')
    expect(reasonLabelOf('bonus')).toBe('bonus')
  })

  it('delta 带符号，负数照写', () => {
    expect(deltaTextOf(2)).toBe('+2 本')
    expect(deltaTextOf(-1)).toBe('-1 本')
    // 0 不该出现（账本里没有 0 的流水），真来了也照实写，不吞掉
    expect(deltaTextOf(0)).toBe('0 本')
  })

  it('分 → 元，两位小数不四舍五入到整元', () => {
    expect(yuanOf(0)).toBe('0.00')
    expect(yuanOf(1160)).toBe('11.60')
    expect(yuanOf(1000)).toBe('10.00')
  })
})
