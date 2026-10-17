/**
 * rerun-api.ts —— 单页重做那一次 `POST /api/books/<id>/pages/<n>` 的**请求契约**（纯函数）
 *
 * 与 `book-api.ts` 同一个理由：把关的代码写在 Route Handler 里，就只能靠手工发请求去测；
 * 写在这里，它可以被测试钉住。
 *
 * ★ 两个字段的**上界**在这儿，不在路由里：
 *   · `fixNote` 进的是**提示词**，一段没有上界的自由文本会被原样送去模型那边；
 *   · `body` 是**书里那一页的字**（阅读器上那几段），它有两个身份——给孩子看的字，
 *     和要念出来的话，所以它的上界按"一页绘本"给。
 *   两个数都与 `book-api.ts` 的 `MAX_TEXT` 同一档：同一类东西（人写的一句话）不该
 *   因为走了另一个入口就换一套长度规矩。
 */

import type { ParseResult } from './book-api.ts'

/** 「这一次哪里不对」那句补充的上界 */
export const MAX_FIX_NOTE = 200
/** 一页正文的上界（它既是阅读器上那几段字，也是要念出来的那段话） */
export const MAX_BODY = 300

export type RerunKind = 'image' | 'audio'

export type RerunBody = {
  kind: RerunKind
  /**
   * ★ 这里原来有 `env`（ADR-0008：密钥随请求上来）。2026-10-17 之后整条退场
   * （ADR-0009）：密钥由站长分配，只从服务端的 `process.env` 来。
   * 理由与 `book-api.ts` 那一段逐字相同——**删掉而不是留着不用**。
   */
  voiceId?: string
  /** 重画：家长写的那句补充。**空串按"没写"处理**（`trim` 之后为空就不带） */
  fixNote?: string
  /**
   * 重配：改过的正文，一句一段。
   * ★ 空行会被**丢掉**（不是报错）：用户在多打了一个换行不该被拦，
   *   而删空了（一行都不剩）要拦——`index.ts` 那边也会再拦一次，
   *   因为空正文会让 `narrateNode` 去要一段空白音频，而厂商那边要么报错要么回静音。
   */
  body?: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseRerunBody(raw: unknown): ParseResult<RerunBody> {
  const problems: string[] = []
  const body = asRecord(raw)
  if (!body) return { ok: false, problems: ['请求体要是一个 JSON 对象'] }

  const kind = body['kind']
  if (kind !== 'image' && kind !== 'audio') {
    problems.push(`kind 只能是 image / audio，收到 ${String(kind)}`)
  }

  const voiceId = typeof body['voiceId'] === 'string' ? body['voiceId'].trim() : ''
  if (voiceId.length > 64) problems.push('音色 id 太长了（64 字以内）')

  const fixNoteRaw = body['fixNote']
  if (fixNoteRaw !== undefined && typeof fixNoteRaw !== 'string') {
    problems.push('fixNote 要是一段文字')
  }
  const fixNote = typeof fixNoteRaw === 'string' ? fixNoteRaw.trim() : ''
  if (fixNote.length > MAX_FIX_NOTE) {
    problems.push(`补充说明太长了（${MAX_FIX_NOTE} 字以内）`)
  }

  let lines: string[] | undefined
  const bodyRaw = body['body']
  if (bodyRaw !== undefined) {
    if (!Array.isArray(bodyRaw) || bodyRaw.some((line) => typeof line !== 'string')) {
      problems.push('body 要是一个字符串数组（一句一段）')
    } else {
      lines = (bodyRaw as string[]).map((line) => line.trim()).filter((line) => line !== '')
      if (lines.length === 0) problems.push('这一页的正文不能是空的——至少留一句话')
      else if (lines.join('').length > MAX_BODY) {
        problems.push(`这一页的正文太长了（${MAX_BODY} 字以内）`)
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    value: {
      kind: kind as RerunKind,
      ...(voiceId ? { voiceId } : {}),
      // ★ 有才带：空串不是"一句空话"，是"没写"
      ...(fixNote ? { fixNote } : {}),
      ...(lines ? { body: lines } : {}),
    },
  }
}
