/**
 * event-log.ts —— 生成过程的落盘日志（ADR-0003 演示路径的数据源）
 *
 * 一行一条**语义事件**（`events.jsonl`）。三条设计选择，每条对应一个具体的失败模式：
 *
 * 1. **一产生就 append，不是跑完再写**。"跑完再写"在中断时什么都不剩，
 *    而中断正是最需要日志的时候（刷新、断线、演示到一半有人拔网线）。
 * 2. **坏行跳过并计数，不崩、不静默**。进程被杀的瞬间，最后一行**一定可能**是半条 JSON。
 *    崩掉的话，前面几十条完好事件的证据全废；静默吞掉的话，
 *    没人分得清"少了 3 条"是引擎没发还是日志读坏了。所以：跳过 + 报数。
 * 3. **重开一轮先截断**。书号是"卡 + 主题指纹"，不含时间戳，所以重跑同一本书
 *    写的是**同一个目录**。不截断就会把两轮混成一条时间线，重放出来的过程是假的。
 *
 * ★ 纯逻辑（`parseEventLog` / `serializeEvent`）与文件系统分开：
 *   前者有测试，后者只在 Route Handler 里跑。与 `providers/stores.ts` 同一套理由——
 *   `pnpm test` 不该碰文件系统。
 *
 * ★ 本模块是**服务端专用**（`node:fs`）。它不在 `lib/engine/` 下，所以不受
 *   "引擎不许碰运行时"那条约束管；但它也**不许被客户端组件 import**——
 *   客户端要读事件，走 `/api/books/<id>/events` 这条 HTTP 路（工单 02 §2.3）。
 */

import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { bookDirOf, type EngineEvent } from './engine/index.ts'

export type EventLogRead = {
  events: EngineEvent[]
  /** 跳过的坏行数（半行、或不是 JSON 的行）。>0 时界面要如实说出来 */
  skipped: number
}

/** 一条事件序列化成一行 JSON（**不带换行**，由写方加，这样 append 的边界由一处决定） */
export function serializeEvent(event: EngineEvent): string {
  return JSON.stringify(event)
}

export function parseEventLog(text: string): EventLogRead {
  const events: EngineEvent[] = []
  let skipped = 0
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.trim() === '') continue // 空行不算坏行：末尾换行一定会产生一个
    try {
      const parsed = JSON.parse(line) as EngineEvent
      if (parsed && typeof parsed === 'object' && typeof parsed.seq === 'number')
        events.push(parsed)
      else skipped += 1
    } catch {
      skipped += 1
    }
  }
  return { events, skipped }
}

export type EventLog = {
  /** 相对路径（相对于资产根）。与 bookDirOf 同源，见 engine/index.ts */
  pathOf(bookId: string): string
  truncate(bookId: string): Promise<void>
  append(bookId: string, event: EngineEvent): Promise<void>
  read(bookId: string): Promise<EventLogRead>
  exists(bookId: string): Promise<boolean>
}

export const EVENTS_FILE = 'events.jsonl'

/** ★ 目录拼法**不在这里定义**，从引擎那边拿（`bookDirOf`）：
 *  日志与 `book.json` 必须落在同一个目录里，两处各拼一遍就会漂。 */
export function eventLogPathOf(bookId: string): string {
  return `${bookDirOf(bookId)}/${EVENTS_FILE}`
}

export async function createFsEventLog(root: string): Promise<EventLog> {
  const base = resolve(root)
  const full = (bookId: string): string => join(base, eventLogPathOf(bookId))

  const log: EventLog = {
    pathOf: eventLogPathOf,
    async truncate(bookId) {
      const target = full(bookId)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, '', 'utf8')
    },
    async append(bookId, event) {
      await appendFile(full(bookId), `${serializeEvent(event)}\n`, 'utf8')
    },
    async read(bookId) {
      try {
        return parseEventLog(await readFile(full(bookId), 'utf8'))
      } catch {
        // 文件不存在 = 这一轮还没开始过（或轮不到这本），不是错误
        return { events: [], skipped: 0 }
      }
    },
    async exists(bookId) {
      try {
        await readFile(full(bookId), 'utf8')
        return true
      } catch {
        return false
      }
    },
  }
  return log
}
