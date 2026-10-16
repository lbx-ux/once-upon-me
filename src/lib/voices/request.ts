/**
 * voices/request.ts —— 「创建音色」这条请求的形状（校验在这一层，路由只负责回话）
 *
 * ★ 校验为什么配得上一个文件：这里每一条拒绝都对应一次**会花钱或会留下东西**的动作。
 *   - 样本是空的 / 太大 → 不该往厂商那边发；
 *   - `mime` 不是我们转出来的那一种 → 说明调用方不是这一屏的客户端（我们只发 WAV）；
 *   - **`consentRef` 缺了就拒**。这一条最要紧：界面上那一步"单独一次同意"如果没有
 *     一个东西钉在请求上，它就只是一段随时可以被绕过的文案。少一个凭据号就 400，
 *     等于"没有那一次同意就没有这条音色"这件事在**接口上**成立，而不只在文案上。
 *
 * ★ 10MB 那个上限与 `qwen-speech.ts` 里的 `MAX_SAMPLE_BYTES` 是同一个数：厂商文档写的。
 *   两处都留着是有意的——那边是"适配器不许把明显不合规的字节发出去"，
 *   这边是"这一条请求本身就不该收下它"。**改的时候两个一起改**（这行注释就是提醒）。
 */

import type { CloneRequest } from '@/lib/engine/providers/types.ts'

/** 我们这一屏的客户端只发这一种：浏览器里解码重采样之后自己写的 WAV（见 audio/capture.ts） */
export const REQUEST_MIME = 'audio/wav'

const MAX_SAMPLE_BYTES = 10 * 1024 * 1024
/** 名字是给人看的，24 个字够长；长了会撑坏卡片那一行的排版 */
const MAX_NAME_CHARS = 24
const DEFAULT_NAME = '我的声音'

export type CloneInput = {
  request: CloneRequest
  name: string
}

export type ParseClone =
  { ok: true; value: CloneInput } | { ok: false; status: number; message: string }

/** base64 → 字节。★ 坏 base64 不会抛，`Buffer.from` 会安静地丢掉不认识的字符，
 *  所以长度判据要落在**解出来之后**（"发了个空样本"就是这么做出来的） */
function bytesOf(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

export function parseCloneRequest(source: Record<string, unknown>): ParseClone {
  const sample = source['sampleBase64']
  if (typeof sample !== 'string' || sample.trim() === '') {
    return { ok: false, status: 400, message: '没有收到样本音频' }
  }

  const mime = String(source['mime'] ?? '').trim()
  if (mime !== REQUEST_MIME) {
    return {
      ok: false,
      status: 400,
      message: `样本要是浏览器转好的 ${REQUEST_MIME}（收到 ${mime || '空'}）`,
    }
  }

  const consentRef = String(source['consentRef'] ?? '').trim()
  if (consentRef === '') {
    return { ok: false, status: 400, message: '缺少授权凭据号：没有那一次单独同意，就不建这条音色' }
  }

  const sampleBytes = bytesOf(sample)
  if (sampleBytes.byteLength === 0) {
    return { ok: false, status: 400, message: '样本解出来是空的' }
  }
  if (sampleBytes.byteLength > MAX_SAMPLE_BYTES) {
    return {
      ok: false,
      status: 400,
      message: `样本超过 10MB（当前 ${(sampleBytes.byteLength / 1024 / 1024).toFixed(1)}MB）`,
    }
  }

  // 名字：剪空白、截长、空了给一个缺省。★ 缺省是「我的声音」而不是"温柔妈妈音"——
  // 我们不知道那是不是妈妈，也不知道温不温柔
  const rawName = String(source['name'] ?? '').trim()
  const name = (rawName === '' ? DEFAULT_NAME : rawName).slice(0, MAX_NAME_CHARS)

  return { ok: true, value: { request: { sampleBytes, mime, consentRef }, name } }
}
