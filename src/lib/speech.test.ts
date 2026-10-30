import { describe, expect, it } from 'vitest'

import {
  normalizeSpoken,
  speechFailureText,
  speechTextOf,
  spokenPickOf,
  type SpeechFailure,
} from './speech.ts'

describe('normalizeSpoken', () => {
  it('去空白与中英文标点', () => {
    expect(normalizeSpoken(' 左 边。')).toBe('左边')
    expect(normalizeSpoken('第一个，好吗？')).toBe('第一个好吗')
    expect(normalizeSpoken('RIGHT!')).toBe('right')
  })
})

describe('speechTextOf', () => {
  it('定稿与中间稿分开拼，顺序按列表', () => {
    expect(
      speechTextOf([
        Object.assign([{ transcript: '我想走' }], { isFinal: true }),
        Object.assign([{ transcript: '左边' }], { isFinal: false }),
      ]),
    ).toEqual({ finals: '我想走', interim: '左边' })
  })

  it('多个定稿段全部拼上（重建，不按 resultIndex 增量）', () => {
    expect(
      speechTextOf([
        Object.assign([{ transcript: '左边' }], { isFinal: true }),
        Object.assign([{ transcript: '那条路' }], { isFinal: true }),
        Object.assign([{ transcript: '吧' }], { isFinal: false }),
      ]),
    ).toEqual({ finals: '左边那条路', interim: '吧' })
  })

  it('空候选不炸，也不留空串以外的痕迹', () => {
    expect(speechTextOf([])).toEqual({ finals: '', interim: '' })
    expect(speechTextOf([Object.assign([], { isFinal: true })])).toEqual({
      finals: '',
      interim: '',
    })
  })
})

describe('spokenPickOf', () => {
  it('方位词落在两边', () => {
    expect(spokenPickOf('左边')).toBe('a')
    expect(spokenPickOf('右边')).toBe('b')
    expect(spokenPickOf('左')).toBe('a')
    expect(spokenPickOf('右')).toBe('b')
  })

  it('一整句里带方位词也认', () => {
    expect(spokenPickOf('我想走左边那条')).toBe('a')
    expect(spokenPickOf('右边那个吧')).toBe('b')
    expect(spokenPickOf('前面那朵云')).toBe('a')
    expect(spokenPickOf('后面')).toBe('b')
  })

  it('序数也认', () => {
    expect(spokenPickOf('第一个')).toBe('a')
    expect(spokenPickOf('第二')).toBe('b')
    expect(spokenPickOf('前一个')).toBe('a')
    expect(spokenPickOf('后一个')).toBe('b')
    // 有的引擎把数字吐成阿拉伯数字
    expect(spokenPickOf('第1个')).toBe('a')
    expect(spokenPickOf('第2')).toBe('b')
  })

  it('繁体与英文都收', () => {
    expect(spokenPickOf('左邊')).toBe('a')
    expect(spokenPickOf('右邊。')).toBe('b')
    expect(spokenPickOf('LEFT')).toBe('a')
    expect(spokenPickOf('right')).toBe('b')
  })

  it('两边同时出现判不出来', () => {
    expect(spokenPickOf('左边还是右边')).toBeNull()
    expect(spokenPickOf('左右')).toBeNull()
  })

  it('空、语气词、与方位无关的词一律判不出来', () => {
    expect(spokenPickOf('')).toBeNull()
    expect(spokenPickOf('   ')).toBeNull()
    expect(spokenPickOf('嗯…')).toBeNull()
    // ★ 这两条是"不写裸的 前/后"那条约定的判据
    expect(spokenPickOf('以前')).toBeNull()
    expect(spokenPickOf('后来')).toBeNull()
  })
})

describe('speechFailureText', () => {
  const kinds: SpeechFailure[] = [
    'unsupported',
    'not-allowed',
    'no-speech',
    'network',
    'audio-capture',
    'unknown',
  ]

  it('每一种失败都有一句人话', () => {
    for (const kind of kinds) {
      expect(speechFailureText(kind).length).toBeGreaterThan(0)
    }
  })

  it('aborted 不说话——那是用户自己取消，不是失败', () => {
    expect(speechFailureText('aborted')).toBe('')
  })
})
