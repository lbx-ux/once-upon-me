/**
 * wait-copy.test.ts —— 等待那几句话的三条纪律
 *
 * 它钉住的不是文案好不好听，是三件会被后人顺手破坏的事：
 *   ① 只有一次请求的活不许有三步（凑三步 = 编进度）；
 *   ② 那几句轮播的话里不许出现数字与百分号（同上）；
 *   ③ 那两句"收起 ≠ 取消"的实话是用户逐字给的（2026-10-18 第 30 刀）——
 *      它们不是我们的文案，是一个已经改过两版的产品决定，重写前先问人。
 *   三条都不花钱、不用起服务器就能验，所以它们该在闸门里。
 */

import { describe, expect, it } from 'vitest'

import { WAIT_JOBS, waitCopyOf } from './wait-copy.ts'

describe('等待时说什么', () => {
  it('★ 只有一次请求的活**没有三步**（凑出来的三步就是编进度）', () => {
    expect(waitCopyOf('revise').steps).toEqual([])
    expect(waitCopyOf('first').steps).toEqual([])
  })

  it('读照片那件活是三步，且大小是已知事实（带在第一步里）', () => {
    const copy = waitCopyOf('analyze', { photoSize: '0.3 MB' })
    expect(copy.steps.map((step) => step.text)).toEqual([
      '照片已选好（0.3 MB）',
      '模型正在读这张照片',
      '把读到的填进右边那几格',
    ])
    expect(copy.steps.map((step) => step.state)).toEqual(['done', 'now', 'todo'])
    // 没给大小就不带那对括号：不许编一个"（未知）"填进去
    expect(waitCopyOf('analyze').steps[0]?.text).toBe('照片已选好')
  })

  it('出图那件活的两段：存档案时第一步是"正在"，档案存好之后第一步变"做完了"', () => {
    const storing = waitCopyOf('draw', { stage: 'profile' })
    expect(storing.steps.map((step) => step.state)).toEqual(['now', 'todo', 'todo'])
    expect(storing.steps[0]?.text).toBe('正在存他的档案')

    const drawing = waitCopyOf('draw', { stage: 'image' })
    expect(drawing.steps.map((step) => step.state)).toEqual(['done', 'now', 'todo'])
    expect(drawing.steps[1]?.text).toBe('正在画他的第一张形象')
  })

  it('每一步的"当前"最多只有一个（该亮的点只能有一个）', () => {
    for (const job of WAIT_JOBS) {
      const copy = waitCopyOf(job, { stage: 'image', photoSize: '0.3 MB' })
      expect(copy.steps.filter((step) => step.state === 'now').length).toBeLessThanOrEqual(1)
      // 「做完了」一定排在「正在」前面——顺序反了就成了"还没做就做完了"
      const states = copy.steps.map((step) => step.state)
      expect(states.indexOf('done')).toBeLessThanOrEqual(
        states.indexOf('now') === -1 ? states.length : states.indexOf('now'),
      )
    }
  })

  it('★ 存档案那一段不播那句话（它不是"在等模型"，是一百毫秒的本地写）', () => {
    expect(waitCopyOf('draw', { stage: 'profile' }).lines).toEqual([])
    // 真出图那一段照旧播（四句都在）
    expect(waitCopyOf('draw', { stage: 'image' }).lines.length).toBe(4)
  })

  it('★ 轮播那几句里不出现数字与百分号（"只说还在办，不说办到哪儿了"）', () => {
    for (const job of WAIT_JOBS) {
      // 用 `stage: 'image'` 取那一份：`draw` 在存档案那一段本来就没有话（上一条）
      const copy = waitCopyOf(job, { stage: 'image' })
      for (const line of copy.lines) {
        expect(line).not.toMatch(/[0-9%]/)
      }
      expect(copy.aside).not.toMatch(/[0-9%]/)
    }
  })

  it('★ 四件活的那句实话都说清了"收起之后它还在跑"（收起 ≠ 取消）', () => {
    for (const job of WAIT_JOBS) {
      const copy = waitCopyOf(job)
      expect(copy.title.trim()).not.toBe('')
      // 「收起」这两个字必须出现：不说它，那颗「收起」就会被读成"停了"
      expect(copy.aside).toContain('收起')
      // 而且要说清收起之后活还在跑（继续重画 / 还在识别）
      expect(copy.aside).toMatch(/继续|还在/)
    }
  })

  it('★ 那两句实话是用户逐字给的（2026-10-18 第 30 刀），一个字都不许被顺口改掉', () => {
    const image = '先收起也没关系，它会继续重画；完成后页面会自动更新。'
    // 三件画图的活说同一句：`draw` 在存档案那一段（`stage: 'profile'`）也是它
    expect(waitCopyOf('revise').aside).toBe(image)
    expect(waitCopyOf('first').aside).toBe(image)
    expect(waitCopyOf('draw', { stage: 'image' }).aside).toBe(image)
    expect(waitCopyOf('draw', { stage: 'profile' }).aside).toBe(image)
    // 读照片那一件说的是"填回右边那几格"，不是"页面会更新"——两件事不一样
    expect(waitCopyOf('analyze').aside).toBe(
      '可以先收起，照片还在识别；识别完成后右侧表单会自动填好。',
    )
  })
})
