/**
 * voices/state.test.ts —— 「这本书会不会有朗读」那条判据
 *
 * ★ 这一组要钉住的是一件事：**三条事实要分开说，而且要按对用户有用的顺序说。**
 *   合成一个布尔的代价不是少一个字段，是"我现在该做什么"这句话没有了——
 *   找站长开权限、等站里配好、还是自己去挑一个，是三个完全不同的下一步。
 *
 * ★ 顺序也测：一个没权限的人不该先被告知"你还没挑音色"。
 *   先挑半天音色然后还是不行，是这个判断最容易犯的那个错。
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  CURRENT_VOICE_KEY,
  loadCurrentVoice,
  narrationBlockOf,
  NARRATION_BLOCK_MESSAGE,
  saveCurrentVoice,
  speechBlockOf,
  CONTACT_EMAIL,
} from './state.ts'

/** 一个够用的假 localStorage。★ 不引 jsdom：这一份是纯函数，只需要三个方法 */
function stubStorage(initial: Record<string, string> = {}): void {
  const map = new Map(Object.entries(initial))
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
      },
    },
  })
}

afterEach(() => {
  // 别把 window 留给下一个测试文件
  Reflect.deleteProperty(globalThis, 'window')
})

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
    // 这一条是把 `speechBlockOf` 与 `narrationBlockOf` 分开的**唯一**理由。
    // 合成一个的话，`/voice` 上"听一句真的"会因为"你还没挑"而永远不能按
    expect(speechBlockOf({ serverHasSpeech: true, allowed: true })).toBeNull()
  })

  it('缺哪一样就说哪一样，与 narration 那两条一致', () => {
    expect(speechBlockOf({ serverHasSpeech: true, allowed: false })).toBe('no-permission')
    expect(speechBlockOf({ serverHasSpeech: false, allowed: true })).toBe('server-not-configured')
  })
})

describe('「选了哪一个」那一格', () => {
  it('没存过 → 空串（= 还没挑）', () => {
    stubStorage()
    expect(loadCurrentVoice()).toBe('')
  })

  it('存进去再读回来是同一个', () => {
    stubStorage()
    saveCurrentVoice('longanlingxi')
    expect(loadCurrentVoice()).toBe('longanlingxi')
  })

  it('用的是一个**新** key，而不是原来那份设置里的一格', () => {
    // ★ 换了 key 就是换了 key：两条断言一起把这件事钉住，免得有人"顺手兼容一下"
    //   又把这一个字符串放回那份装着密钥形状的存储里去
    stubStorage({ 'xiaozhujue.settings.v1': '{"speech":{"voice":"longanlingxi"}}' })
    expect(loadCurrentVoice()).toBe('')
    saveCurrentVoice('yun')
    expect(globalThis.window.localStorage.getItem(CURRENT_VOICE_KEY)).toBe('yun')
  })

  it('storage 抛错时不炸（隐私模式下照样能用，只是下次要重选）', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => {
            throw new Error('nope')
          },
          setItem: () => {
            throw new Error('nope')
          },
        },
      },
    })
    expect(loadCurrentVoice()).toBe('')
    expect(() => saveCurrentVoice('yun')).not.toThrow()
  })

  it('服务端（没有 window）读回来是空串，不抛', () => {
    expect(loadCurrentVoice()).toBe('')
    expect(() => saveCurrentVoice('yun')).not.toThrow()
  })
})
