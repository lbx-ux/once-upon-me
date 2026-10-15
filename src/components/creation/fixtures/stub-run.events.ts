/**
 * stub-run.events.ts —— 一次**真跑**留下来的事件流（设备：`--mode=stub`）
 *
 * 怎么来的（2026-10-15）：
 *
 * ```bash
 * node scripts/engine-run.mts --mode=stub --pages=5 --out=.out/frames-probe
 * # 事件在 .out/frames-probe/summary.json 的 eventsRaw 里，逐条抄下来
 * ```
 *
 * ★ 只省掉了 `at`（epoch 毫秒）——它每次都不同，留着会让这个文件每次重录都变，
 *   而没有任何一条断言会读它。**其余字段一字未改**。
 * ★ 它不是"我以为引擎会发的顺序"，是引擎**真的**按这个顺序发的：
 *   `scripts/engine-run.mts` 与线上那条路调的是同一个 `runBook`。
 *   `frames.test.ts` 拿它钉住"按页码归格"这件事——手写的用例能表达规则，
 *   但表达不了"引擎实际怎么发"。
 * ★ 这一条流里**没有重画**（`--mode=stub` 的替身永远一次通过，`attempt` 全是 1），
 *   所以"重画是覆盖同一格"那条规则由测试里手写的事件钉住，不是由它。
 *   把这条写在这里，是为了不让下一个人以为这份 fixture 覆盖了那件事。
 */

import type { EngineEvent } from '@/lib/engine/events.ts'

/** 19 条：规划 → 5 页逐个「开始画 / 画好 / 无法核对」→ 配音没接上的非致命错 → 装订好 */
export const STUB_RUN_EVENTS: EngineEvent[] = [
  { seq: 1, stage: 'planning', kind: 'stage', phase: 'begin', attempt: 1, total: 3 },
  {
    seq: 2,
    stage: 'planning',
    kind: 'plan-ready',
    form: 'shared',
    title: '小宇的云',
    nodeCount: 5,
    choicePages: [3],
  },
  { seq: 3, stage: 'illustrating', kind: 'stage', phase: 'begin', pageNo: 1, attempt: 1, total: 3 },
  {
    seq: 4,
    stage: 'illustrating',
    kind: 'illustration',
    pageNo: 1,
    attempt: 1,
    assetPath: 'books/xiaolu-r1-3befb9c2a76b/page-1-a1.webp',
    modelId: 'pregenerated-demo-art',
    costCny: 0,
  },
  {
    seq: 5,
    stage: 'checking',
    kind: 'consistency',
    pageNo: 1,
    attempt: 1,
    score: null,
    verdict: 'unavailable',
    threshold: 0.75,
    missedAnchors: [],
  },
  { seq: 6, stage: 'illustrating', kind: 'stage', phase: 'begin', pageNo: 2, attempt: 1, total: 3 },
  {
    seq: 7,
    stage: 'illustrating',
    kind: 'illustration',
    pageNo: 2,
    attempt: 1,
    assetPath: 'books/xiaolu-r1-3befb9c2a76b/page-2-a1.webp',
    modelId: 'pregenerated-demo-art',
    costCny: 0,
  },
  {
    seq: 8,
    stage: 'checking',
    kind: 'consistency',
    pageNo: 2,
    attempt: 1,
    score: null,
    verdict: 'unavailable',
    threshold: 0.75,
    missedAnchors: [],
  },
  { seq: 9, stage: 'illustrating', kind: 'stage', phase: 'begin', pageNo: 3, attempt: 1, total: 3 },
  {
    seq: 10,
    stage: 'illustrating',
    kind: 'illustration',
    pageNo: 3,
    attempt: 1,
    assetPath: 'books/xiaolu-r1-3befb9c2a76b/page-3-a1.webp',
    modelId: 'pregenerated-demo-art',
    costCny: 0,
  },
  {
    seq: 11,
    stage: 'checking',
    kind: 'consistency',
    pageNo: 3,
    attempt: 1,
    score: null,
    verdict: 'unavailable',
    threshold: 0.75,
    missedAnchors: [],
  },
  {
    seq: 12,
    stage: 'illustrating',
    kind: 'stage',
    phase: 'begin',
    pageNo: 4,
    attempt: 1,
    total: 3,
  },
  {
    seq: 13,
    stage: 'illustrating',
    kind: 'illustration',
    pageNo: 4,
    attempt: 1,
    assetPath: 'books/xiaolu-r1-3befb9c2a76b/page-4-a1.webp',
    modelId: 'pregenerated-demo-art',
    costCny: 0,
  },
  {
    seq: 14,
    stage: 'checking',
    kind: 'consistency',
    pageNo: 4,
    attempt: 1,
    score: null,
    verdict: 'unavailable',
    threshold: 0.75,
    missedAnchors: [],
  },
  {
    seq: 15,
    stage: 'illustrating',
    kind: 'stage',
    phase: 'begin',
    pageNo: 5,
    attempt: 1,
    total: 3,
  },
  {
    seq: 16,
    stage: 'illustrating',
    kind: 'illustration',
    pageNo: 5,
    attempt: 1,
    assetPath: 'books/xiaolu-r1-3befb9c2a76b/page-5-a1.webp',
    modelId: 'pregenerated-demo-art',
    costCny: 0,
  },
  {
    seq: 17,
    stage: 'checking',
    kind: 'consistency',
    pageNo: 5,
    attempt: 1,
    score: null,
    verdict: 'unavailable',
    threshold: 0.75,
    missedAnchors: [],
  },
  {
    seq: 18,
    stage: 'narrating',
    kind: 'error',
    code: 'provider-not-configured',
    message: '配音能力没接上（TTS_API_KEY / TTS_MODEL 未配置），这本书没有朗读',
    fatal: false,
  },
  {
    seq: 19,
    stage: 'assembling',
    kind: 'book-ready',
    bookId: 'xiaolu-r1-3befb9c2a76b',
    path: 'books/xiaolu-r1-3befb9c2a76b/book.json',
    stats: {
      elapsedMs: 51,
      imageCalls: 5,
      firstPassCount: 0,
      redrawCount: 0,
      totalCostCny: 0,
      nodesPlanned: 5,
      nodesGenerated: 5,
    },
  },
] as EngineEvent[]
