/**
 * event-log.test.ts —— 测纯的那一半（`serializeEvent` / `parseEventLog`），
 * 外加一节书号的路径边界（那一节要真磁盘，见文件末尾）。
 *
 * 重点在坏行：这个文件存在的全部意义是"重放能重建同一串界面状态"，
 * 而它建立在"日志是完整的"这个假设上。进程被杀的瞬间最后一行是半条 JSON，
 * 那是最常见的一种不完整——所以它必须有测试，而不是"应该不会发生"。
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsEventLog, parseEventLog, serializeEvent } from './event-log.ts'
import type { EngineEvent } from './engine/index.ts'

const event = (seq: number, kind = 'stage'): EngineEvent =>
  ({ seq, at: 1_760_000_000_000 + seq, stage: 'planning', kind, phase: 'begin' }) as EngineEvent

describe('serializeEvent / parseEventLog', () => {
  it('往返保持逐字段相等', () => {
    const original = event(1)
    const read = parseEventLog(`${serializeEvent(original)}\n`)
    expect(read.skipped).toBe(0)
    expect(read.events).toEqual([original])
  })

  it('一行一条，顺序不变', () => {
    const text = [event(1), event(2), event(3)].map(serializeEvent).join('\n') + '\n'
    expect(parseEventLog(text).events.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('末尾没有换行也读得出来（append 正在写的那一刻）', () => {
    expect(parseEventLog(serializeEvent(event(1))).events).toHaveLength(1)
  })

  it('CRLF 也认', () => {
    expect(parseEventLog(`${serializeEvent(event(1))}\r\n`).events).toHaveLength(1)
  })

  it('空文本 = 0 条 0 坏行（第一次跑、日志刚被截断）', () => {
    expect(parseEventLog('')).toEqual({ events: [], skipped: 0 })
    expect(parseEventLog('\n\n')).toEqual({ events: [], skipped: 0 })
  })
})

describe('坏行：跳过并计数，不崩、不静默', () => {
  it('半条 JSON 被跳过，前面完好的那些还在', () => {
    const text = `${serializeEvent(event(1))}\n${serializeEvent(event(2))}\n{"seq":3,"at":17`
    const read = parseEventLog(text)
    expect(read.events.map((e) => e.seq)).toEqual([1, 2])
    expect(read.skipped).toBe(1)
  })

  it('不是 JSON 的行也算坏行', () => {
    expect(parseEventLog('这不是 JSON\n').skipped).toBe(1)
  })

  it('是 JSON 但没有 seq 的，同样算坏行（不是事件）', () => {
    // 漏了这条，一个被写坏成 `{"error":"..."}` 的行会混进事件流，
    // 界面按 EngineEvent 的字段去读它会得到一片 undefined
    expect(parseEventLog('{"hello":"world"}\n').skipped).toBe(1)
  })

  it('坏行在中间也不影响后面的', () => {
    const text = `${serializeEvent(event(1))}\n{oops\n${serializeEvent(event(2))}\n`
    const read = parseEventLog(text)
    expect(read.events.map((e) => e.seq)).toEqual([1, 2])
    expect(read.skipped).toBe(1)
  })
})

/**
 * 这一组是唯一碰磁盘的：日志不走 store（引擎不该知道它），所以 store 那道
 * `assertInsideScope` 管不到这里，书号的边界要自己守（2026-10-22 审查）。
 */
describe('★ 书号的路径边界', () => {
  it('带 `..` 的书号读不出来、也写不进去', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xzj-event-log-'))
    try {
      const victim = join(root, '7', 'books', 'victim')
      await mkdir(victim, { recursive: true })
      await writeFile(join(victim, 'events.jsonl'), `${serializeEvent(event(1))}\n`, 'utf8')

      // 3 号那一片。`../7/books/victim` 拼出来是 books/../7/books/victim/events.jsonl
      const log = await createFsEventLog(join(root, '3'))
      // 读与存在性：异常吞成"这一轮没开始过"，不能回别人的事件
      expect(await log.read('../7/books/victim')).toEqual({ events: [], skipped: 0 })
      expect(await log.exists('../7/books/victim')).toBe(false)
      // 写：必须抛，不能落到别人那一片
      await expect(log.append('../7/books/victim', event(2))).rejects.toThrow()
      await expect(log.truncate('../7/books/victim')).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
