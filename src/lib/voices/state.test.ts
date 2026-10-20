/**
 * voices/state.test.ts —— 「这本书会不会有朗读」那条判据
 *
 * 这一组要钉住的是一件事：三条事实要分开说，而且要按对用户有用的顺序说。
 *   合成一个布尔的代价不是少一个字段，是"我现在该做什么"这句话没有了——
 *   找站长开权限、等站里配好、还是自己去挑一个，是三个完全不同的下一步。
 *
 * 顺序也测：一个没权限的人不该先被告知"你还没挑音色"。
 *   先挑半天音色然后还是不行，是这个判断最容易犯的那个错。
 *
 * 2026-10-17（工单 16）起这里还管第二件事：服务端回来的那一份怎么读
 *   （`parseMyVoices`）。它原来测的是 localStorage 里的半截 JSON，
 *   而那一份搬到账号上之后，坏数据的形状变成了"跨进程来的字段缺一个"。
 */

import { describe, expect, it } from 'vitest'

import {
  narrationBlockOf,
  NARRATION_BLOCK_MESSAGE,
  parseMyVoices,
  speechBlockOf,
  CONTACT_EMAIL,
} from './state.ts'

describe('narrationBlockOf · 缺的是哪一条', () => {
  const ok = { serverHasSpeech: true, allowed: true, voiceId: 'longjielidou_v3.6' }

  it('三条都齐 → null（界面据此说"这一本会有朗读"）', () => {
    expect(narrationBlockOf(ok)).toBeNull()
  })

  it('★ 顺序：没权限先说没权限，哪怕音色也没挑', () => {
    // 反过来的话，一个没权限的人会先去挑半天音色，然后还是不行
    expect(narrationBlockOf({ ...ok, allowed: false, voiceId: '' })).toBe('no-permission')
  })

  it('有权限、站里没配 → 说的是站里没配（不是"你没挑音色"）', () => {
    expect(narrationBlockOf({ ...ok, serverHasSpeech: false, voiceId: '' })).toBe(
      'server-not-configured',
    )
  })

  it('前两条都过、没挑音色 → no-voice（唯一一条用户自己能解决的）', () => {
    expect(narrationBlockOf({ ...ok, voiceId: '   ' })).toBe('no-voice')
  })

  it('★ 三种说法各不相同的，而且只有"没挑音色"那句不带联系方式', () => {
    const values = Object.values(NARRATION_BLOCK_MESSAGE)
    expect(new Set(values).size).toBe(3)
    // 前两种不是用户能自己解决的，所以必须说怎么找人（一句"请联系管理员"是没用的）
    expect(NARRATION_BLOCK_MESSAGE['no-permission']).toContain(CONTACT_EMAIL)
    expect(NARRATION_BLOCK_MESSAGE['server-not-configured']).toContain(CONTACT_EMAIL)
    expect(NARRATION_BLOCK_MESSAGE['no-voice']).not.toContain(CONTACT_EMAIL)
  })
})

describe('speechBlockOf · 试听那类事要的那一条', () => {
  it('★ 它**不看音色**：正在挑的人还没挑，而那颗钮按下去正是去挑', () => {
    // 这一条是把 `speechBlockOf` 与 `narrationBlockOf` 分开的唯一理由。
    // 合成一个的话，`/voice` 上"听一句真的"会因为"你还没挑"而永远不能按
    expect(speechBlockOf({ serverHasSpeech: true, allowed: true })).toBeNull()
  })

  it('缺哪一样就说哪一样，与 narration 那两条一致', () => {
    expect(speechBlockOf({ serverHasSpeech: true, allowed: false })).toBe('no-permission')
    expect(speechBlockOf({ serverHasSpeech: false, allowed: true })).toBe('server-not-configured')
  })
})

describe('★ 服务端那一份读回来是什么样（工单 16）', () => {
  const row = {
    voiceId: 'longanlingxi',
    name: '灵灵',
    model: 'qwen-audio-3.0-tts-flash',
    createdAt: '2026-10-17T04:05:06+08:00',
  }

  it('读得回来：id、名字、模型、时间（ISO → 毫秒）', () => {
    const parsed = parseMyVoices({ voices: [row], current: 'longanlingxi' })
    expect(parsed?.current).toBe('longanlingxi')
    expect(parsed?.voices[0]).toEqual({
      voiceId: 'longanlingxi',
      name: '灵灵',
      modelId: 'qwen-audio-3.0-tts-flash',
      createdAt: Date.parse('2026-10-17T04:05:06+08:00'),
    })
  })

  it('current 是空串 = 还没挑（不是 null：界面那一格就是一个字符串）', () => {
    expect(parseMyVoices({ voices: [], current: '' })).toEqual({ voices: [], current: '' })
  })

  it('★ 认不出来就**整份拒绝**，不是丢掉坏的那一条', () => {
    // 半个列表比没有更坏：它会显示成"你只录过这一条"，
    //   而真相可能是"有两条，另一条没画出来"——用户会以为那条没了，然后重录一遍
    expect(parseMyVoices({ voices: [row, { voiceId: 'x' }], current: '' })).toBeNull()
    expect(parseMyVoices({ voices: [{ ...row, createdAt: '不是时间' }], current: '' })).toBeNull()
    expect(parseMyVoices({ voices: [row] })).toBeNull()
    expect(parseMyVoices({ voices: 'longanlingxi', current: '' })).toBeNull()
    expect(parseMyVoices(null)).toBeNull()
  })

  it('模型可以是空串（录它时没记下来），但 id 与名字不能空', () => {
    const parsed = parseMyVoices({ voices: [{ ...row, model: '' }], current: '' })
    expect(parsed?.voices[0]?.modelId).toBe('')
    expect(parseMyVoices({ voices: [{ ...row, voiceId: '  ' }], current: '' })).toBeNull()
  })
})
