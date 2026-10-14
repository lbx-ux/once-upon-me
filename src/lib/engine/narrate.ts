/**
 * narrate.ts —— ④ 逐页配音（TTS 在 W2 时留的是 `voice: null` 的 seam，这里是第一个消费方）
 *
 * 与 `illustrate.ts` 同构：逐页串行、失败不终止整条流、每条产出都发事件。
 * 但它比出图简单得多——没有一致性校验、没有重画、没有"像不像"这件事。
 *
 * ★ 四条不显然的规则：
 *
 * 1. **去重键是 `(voiceId, textHash)`，不是页码**。共读版的故事树里主干页会被多个
 *    分支共用，同一段正文合成两次是白花钱；`domain.ts` 的 `Narration` 注释早就把
 *    这个键写死了。复用的那几页 `asset` 指向**同一个文件**（`reused: true`），
 *    所以磁盘上不会有 `page-7-a1.mp3`——这不是漏了，是它们本来就是一份录音。
 * 2. **正文用 `body.join('')` 拼接，不加空格**。这不是随手写的：实测那句
 *    "哗啦啦，大雨落下来。地上变成亮晶晶的河。"（两句直接相连）合成出来约 2.5 秒，
 *    这个数是按 `join('')` 量的。改成 `join(' ')` 会插进一个未经测量的停顿，
 *    要把 §1.2c 的时长与体积估算一起重测。
 * 3. **一页配不上音不影响别的页，但必须留下痕迹**。所以这里抛出的错会被
 *    `narrateAll` 收成 `{pageNo, message}` 并补一条非致命的 `error` 事件——
 *    书照样装订，但"这一页没声音"是可查的，不是静默的。
 *    （这条对应 app-restructure spec 里"要么整本书都能响"那个判据：
 *    接线之前先要看清整本到底响不响。）
 * 4. **不传 `mood` 也不传 `pronunciation`**。两者在适配器里都还没接，
 *    传进去会直接报错（见 qwen-speech.ts 文件头第 5 条）。**这是有意的**：
 *    情绪标签与读音纠正都是"没测过就不许装作有"的能力，
 *    宁可让它们缺席，也不要让每一页读成同一个调子还无人知道。
 */

import { digest } from './digest.ts'
import { asEngineError } from './errors.ts'
import { extensionOf } from './providers/stores.ts'
import type { Narration, StoryNode } from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import type { AssetStore, VoiceSynthesizer } from './providers/types.ts'

export type NarrateOptions = {
  /** null 时调用方不该进这一层（见 index.ts 的非致命事件） */
  voice: VoiceSynthesizer
  /** 用哪个音色。默认音色与克隆音色在这里没有区别——都是厂商侧的一个 id */
  voiceId: string
  store: AssetStore
  bookId: string
  emit: (payload: EngineEventPayload) => void
}

export type NarrateResult = {
  narrations: Narration[]
  /** 没配上音的页。★ 与"这本书没有配音"是两件事，别合并 */
  errors: { pageNo: number; message: string }[]
}

/** 一页要念的正文。规则 2：`join('')`，不是 `join(' ')` */
export function narrationTextOf(node: StoryNode): string {
  return node.body.join('')
}

export async function narrateAll(
  nodes: readonly StoryNode[],
  opts: NarrateOptions,
): Promise<NarrateResult> {
  const narrations: Narration[] = []
  const errors: { pageNo: number; message: string }[] = []
  /** key = `${voiceId}:${textHash}` → 已经落盘的那份录音 */
  const done = new Map<string, Narration>()

  opts.emit({ kind: 'stage', stage: 'narrating', phase: 'begin' })

  for (const node of nodes) {
    const text = narrationTextOf(node)
    if (text.trim() === '') {
      // 空正文不合成。★ 不报错也不留空文件：没有正文的页本来就没有"配音"这回事
      continue
    }
    const textHash = digest(text)
    const key = `${opts.voiceId}:${textHash}`

    const reused = done.get(key)
    if (reused) {
      // 规则 1：同一份录音只落一次盘，多个页面共用同一个 asset
      narrations.push({ ...reused, pageNo: node.pageNo })
      opts.emit({
        kind: 'narration',
        stage: 'narrating',
        pageNo: node.pageNo,
        voiceId: opts.voiceId,
        assetPath: reused.asset.path,
        reused: true,
      })
      continue
    }

    try {
      const response = await opts.voice.synthesize({ voiceId: opts.voiceId, text })
      const asset = await opts.store.put({
        path: `books/${opts.bookId}/page-${node.pageNo}-a1${extensionOf(response.mime)}`,
        bytes: response.bytes,
        mime: response.mime,
      })
      const entry: Narration = {
        pageNo: node.pageNo,
        voiceId: opts.voiceId,
        textHash,
        asset,
      }
      done.set(key, entry)
      narrations.push(entry)
      opts.emit({
        kind: 'narration',
        stage: 'narrating',
        pageNo: node.pageNo,
        voiceId: opts.voiceId,
        assetPath: asset.path,
        reused: false,
      })
    } catch (err) {
      const failure = asEngineError(err)
      errors.push({ pageNo: node.pageNo, message: failure.message })
      opts.emit({
        kind: 'error',
        stage: 'narrating',
        pageNo: node.pageNo,
        code: failure.code,
        message: `这一页没配上音：${failure.message}`,
        fatal: false,
      })
    }
  }

  opts.emit({ kind: 'stage', stage: 'narrating', phase: 'end' })
  return { narrations, errors }
}
