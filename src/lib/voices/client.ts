/**
 * voices/client.ts —— 「我的音色」那四条请求（**只在浏览器里跑**）
 *
 * ★ 与 `lib/admin/client.ts`、`lib/requests/client.ts` 同一条纪律：打的是**同源的 BFF**
 *   （`/api/voices/*`），不是 Java 那个地址。理由写在 `auth/client.ts` 里那段
 *   （后端地址不进浏览器、票在 httpOnly cookie 里、跨源就没有 cookie）。
 *
 * ★ 打的是 `/api/voices`（复数），**不是** `/api/voice/*`（单数）。那两个命名空间
 *   各管一件事，别混：
 *   · `/api/voice/clone` `/api/voice/preview` `/api/voice/delete` —— **厂商侧的动作**
 *     （要花能力、要花钱、样本只在那条路上出现）；
 *   · `/api/voices` —— **这个账号记着哪些音色、现在用哪一个**（我们自己的库）。
 *
 * ★ 四条动作里有三条回**同一份东西**（`MyVoices`）：我的列表 + 当前是哪一个。
 *   调用方拿它整份替换本地状态，而不是自己推算"我这一步之后应该是什么样"——
 *   于是"切了但没存上""删了但界面还在"这两类假象没有藏身之处。
 */

import { readResult, unreachable, type Result } from '@/lib/auth/response.ts'
import { CONTACT_EMAIL, parseMyVoices, type MyVoices } from './state.ts'

export type VoiceOk<T> = { ok: true; data: T }
export type VoiceFail = { ok: false; message: string; status: number }

async function call(path: string, init: RequestInit): Promise<VoiceOk<MyVoices> | VoiceFail> {
  let response: Response
  try {
    response = await fetch(path, { cache: 'no-store', ...init })
  } catch (err) {
    const failure = unreachable(err instanceof Error ? err.message : String(err))
    return { ok: false, message: failure.message, status: 0 }
  }

  const result: Result<unknown> = await readResult<unknown>(response)
  if (!result.ok) return { ok: false, message: result.message, status: result.status }

  const parsed = parseMyVoices(result.data)
  if (!parsed) {
    // ★ 认不出来时说**形状**的问题，不伪造一份空的——那会显示成"你还没录过音色"，
    //   而真相可能是"有两条，一条都没画出来"。
    // ★ 2026-10-17 补了后半句，因为**"刷新一次试试"是错的建议**：实测到的那一次
    //   （服务端给预置音色落了一行空名字）刷新一百次也一样——那一份记录本身坏了，
    //   它不是用户这边的事。所以这句话现在说"说一声"，与 `no-permission` 那类
    //   "不是你造成的"用同一条出口（`CONTACT_EMAIL`）。
    return {
      ok: false,
      message: `服务端回的这份音色记录读不出来（多半是里面某一条缺了名字或时间）。这不是你这边能改的——说一声 ${CONTACT_EMAIL}`,
      status: 200,
    }
  }
  return { ok: true, data: parsed }
}

const JSON_POST = { 'Content-Type': 'application/json; charset=utf-8' }

/** 我的音色 + 现在用哪一个（进 `/voice` 那一屏、或者任何要显示"当前音色"的地方） */
export async function fetchVoices(): Promise<VoiceOk<MyVoices> | VoiceFail> {
  return call('/api/voices', { method: 'GET' })
}

/**
 * 选一个（`voiceId` 空串 = 取消选择，条目留着）。
 *
 * ★ `name` / `model` 只有调用方**知道**的时候才带：服务端那一条"给了才覆盖"
 *   （见 `VoiceService#choose`），而界面上"只切一次选择"的地方未必读过模型——
 *   用空串覆盖会把 `model` 那一列擦掉，而它正是"模型还对得上吗"那条判据的输入。
 */
export async function chooseVoice(
  voiceId: string,
  known?: { name: string; model: string },
): Promise<VoiceOk<MyVoices> | VoiceFail> {
  return call('/api/voices/current', {
    method: 'PUT',
    headers: JSON_POST,
    body: JSON.stringify({
      voiceId,
      ...(known ? { name: known.name, model: known.model } : {}),
    }),
  })
}

/** 记一条刚录出来的音色（它自己会成为当前）。★ 名字与模型**必须**给 */
export async function rememberVoiceOnServer(voice: {
  voiceId: string
  name: string
  modelId: string
}): Promise<VoiceOk<MyVoices> | VoiceFail> {
  return call('/api/voices', {
    method: 'POST',
    headers: JSON_POST,
    body: JSON.stringify({ voiceId: voice.voiceId, name: voice.name, model: voice.modelId }),
  })
}

/**
 * 删掉一条**记录**。
 *
 * ★ 它**不碰厂商那边**——解绑是 `/api/voice/delete` 的事（那条要能力、要花钱）。
 *   两条分开是有意的：账户上不想要这一条，与"厂商账号里还有这条嗓子"是两件事，
 *   而合成一条的话，一次网络抖动会让人以为"厂商那边也删干净了"。
 */
export async function forgetVoiceOnServer(voiceId: string): Promise<VoiceOk<MyVoices> | VoiceFail> {
  return call(`/api/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' })
}
