/**
 * run-phase-lines.test.ts —— 画桌上方那一句主句的优先级（2026-10-21，工单 D-34）
 *
 * 这一段是从 `GenerationRun.tsx` 的 JSX 里拔出来的六档判断。它原来长这样：
 *
 * ```tsx
 * {phase === 'planning' && '…'}
 * {atGate && working !== 'rewriting' && '…'}
 * {atGate && working === 'rewriting' && '…'}
 * {phase === 'running' && '…'}
 * {phase === 'replaying' && (serverRunning ? '…' : '…')}
 * {phase === 'ready' && (published ? '…' : '…')}
 * {phase === 'failed' && '…'}
 * ```
 *
 * 七行平铺在 JSX 里时，它们**互不排斥这件事是隐式的**：只要没人同时写两句，
 * 屏幕上就看不出问题。而"同时成立"的时刻是真的有 —— `ready` 那一档永远带着
 * `published` 或不带，`atGate` 与 `working` 是两条独立的轴。
 * 拔成纯函数之后，优先级变成一行代码，而这几条能在 node 里钉住。
 *
 * ★ 钉住的第二件事：**这一句不许出现数字与百分比**。
 *   它是这一屏上最大的一行字，而"编故事"那一段原来没有任何真进度
 *   （见 `plan-lines.ts` 文件头）。2026-10-21 接了令牌级流式之后，
 *   真进度有了 —— 但它走的是**另一条**（`lib/engine/plan-stream.ts` 那一份
 *   已闭合的页数），不是这一句。这一句只说"现在在做什么、接下来会怎样"。
 */

import { describe, expect, it } from 'vitest'

import { phaseLineOf, type PhaseLineInput } from './run-phase-lines.ts'

/** 一条都不成立的底：每一档各显一次形，下面的用例只改它要测的那一格 */
const BASE: PhaseLineInput = {
  phase: 'planning',
  atGate: false,
  rewriting: false,
  published: false,
  serverRunning: false,
}

const of = (over: Partial<PhaseLineInput>): string | null => phaseLineOf({ ...BASE, ...over })

describe('主句 · 六档各说各的', () => {
  it('六档都有一句，而且互不相同', () => {
    const lines = [
      of({ phase: 'planning' }),
      of({ phase: 'story', atGate: true }),
      of({ phase: 'story', atGate: true, rewriting: true }),
      of({ phase: 'running' }),
      of({ phase: 'replaying', serverRunning: true }),
      of({ phase: 'replaying' }),
      of({ phase: 'ready' }),
      of({ phase: 'ready', published: true }),
      of({ phase: 'failed' }),
    ]
    for (const line of lines) expect(typeof line).toBe('string')
    // 九格里有几句是同一件事的两种说法，但**每一句都非空**
    expect(lines.filter((line) => line === null)).toEqual([])
    expect(new Set(lines).size).toBe(9)
  })

  it('★ 重写那一段换一句（用户："这样用户怎么知道有没有重新生成故事呢"）', () => {
    // 闸门上真正的两条轴：`working` 与它无关的那一份状态
    expect(of({ phase: 'story', atGate: true })).not.toBe(
      of({ phase: 'story', atGate: true, rewriting: true }),
    )
    expect(of({ phase: 'story', atGate: true, rewriting: true })).toContain('正在按你说的重写')
  })

  it('★ 装订与否是两句（`published` 只能盖住 `ready`）', () => {
    expect(of({ phase: 'ready' })).toContain('确定生成')
    expect(of({ phase: 'ready', published: true })).toContain('已经装订好')
  })

  it('★ "还在跑"与"连接断了"是两句（这一档分不出别的，只有 status 帧说得出）', () => {
    expect(of({ phase: 'replaying', serverRunning: true })).toContain('会自己长出来')
    expect(of({ phase: 'replaying' })).toContain('没有跑完')
  })

  it('闸门没开着就说不出话：`story` 那一档不许硬编一句', () => {
    // 故事不在手上时闸门不开（`atGate` 含 `story !== null`），
    // 而"这一屏在干什么"这时候没有答案
    expect(of({ phase: 'story' })).toBeNull()
    expect(of({ phase: 'story', rewriting: true })).toBeNull()
  })
})

describe('主句 · 两条纪律', () => {
  it('★ 不出现数字、百分比、时刻（真进度在另一条路上）', () => {
    for (const phase of ['planning', 'story', 'running', 'replaying', 'ready', 'failed'] as const) {
      for (const serverRunning of [true, false]) {
        for (const published of [true, false]) {
          for (const rewriting of [true, false]) {
            const line = of({ phase, atGate: true, serverRunning, published, rewriting })
            if (line === null) continue
            expect(line).not.toMatch(/[0-9%]/)
            expect(line).not.toMatch(/还剩|剩余|马上|秒/)
          }
        }
      }
    }
  })

  it('★ 每一句都说得出下一步（不是第二句"正在生成"）', () => {
    const lines = [
      of({ phase: 'planning' }),
      of({ phase: 'story', atGate: true }),
      of({ phase: 'story', atGate: true, rewriting: true }),
      of({ phase: 'running' }),
      of({ phase: 'replaying', serverRunning: true }),
      of({ phase: 'replaying' }),
      of({ phase: 'ready' }),
      of({ phase: 'ready', published: true }),
      of({ phase: 'failed' }),
    ] as string[]
    for (const line of lines) expect(line.length).toBeGreaterThan(8)
  })
})
