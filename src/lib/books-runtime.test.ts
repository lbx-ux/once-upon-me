/**
 * books-runtime.test.ts —— 生成租约的**键**（2026-10-20 正确性通读时补的）
 *
 * 这本账挡的是"同一本书两轮同时跑"（一份日志被两轮事件交叉写入、后跑的把
 * `book.json` 覆盖掉）。它挡得对不对，全看**键**：
 *
 * - 键里**少了 userId**：甲在跑这本书时，乙点「开一本」会收到 409
 *   「这本书正在生成中」——一句关于**别人的、他看不见的那本书**的拒绝。
 *   这正是 `runKeyOf` 那段注释记下的那个 bug（书号是"卡 + 主题 + 形态"的指纹，
 *   **不含账号**，所以两个账号给同名孩子配同一个主题会推出同一个书号）。
 * - 键里**多了别的东西**（比如时间戳）：两次点击各拿一把锁，谁也挡不住谁，
 *   而并发保护那几行看上去完全正确。
 *
 * 两条都不靠读代码看得出来（症状都长得像"正常"），所以钉在这里。
 */

import { describe, expect, it } from 'vitest'

import { isRunning, finishRun, runKeyOf, tryStartRun } from './books-runtime.ts'

describe('生成租约', () => {
  it('同一个人的同一本书：挡住第二次', () => {
    const key = runKeyOf('1', 'kid-ab-9f2c1a4b7e30')
    expect(tryStartRun(key)).toBe(true)
    expect(tryStartRun(key)).toBe(false)
    finishRun(key)
    expect(isRunning(key)).toBe(false)
  })

  it('★ 租约键按人分开：甲在跑，乙不受影响（工单 16 那条）', () => {
    const book = 'kid-ab-9f2c1a4b7e30'
    const mine = runKeyOf('1', book)
    const theirs = runKeyOf('7', book)
    expect(mine).not.toBe(theirs)

    expect(tryStartRun(mine)).toBe(true)
    expect(tryStartRun(theirs)).toBe(true)

    // ★ 放掉自己那把不许把别人那把也放掉（`finishRun` 删的是一个键，不是"整本"）
    finishRun(mine)
    expect(isRunning(mine)).toBe(false)
    expect(isRunning(theirs)).toBe(true)
    finishRun(theirs)
  })

  it('键里真的带着是谁（不是只有书号）', () => {
    expect(runKeyOf('1', 'bk')).toBe('1/bk')
    expect(runKeyOf('1', 'bk')).not.toBe('bk')
  })
})
