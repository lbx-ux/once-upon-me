/**
 * book-api.test.ts —— 那一次 `POST /api/books` 的请求契约
 *
 * 工单 02 与 03 各往这个契约里加了一个字段，而这两个字段都有一种**看不出来**的坏法：
 *
 * 1. **`voiceId` 整条缺席过一次**（不是值错了，是字段根本不在类型里）。
 *    症状是"界面上一路看着都对，做出来的书没有声音"——因为引擎收到的永远是
 *    `undefined`，它按"这一本不配音"如实处理。所以这一节钉的第一件事是
 *    **带它 / 不带它**都要能过，且不带时那个字段**不出现**。
 * 2. **`status` 的缺省是成品**（`Book.status` 的迁移决定）。钉住"不传就不写"，
 *    免得有人顺手 `?? 'draft'`——那会让盘上老的 `book.json` 与演示书一起从书架消失。
 *
 * ★ 校验的判据（年龄档、形态）来自引擎的领域类型，这一节不重复测那几条——
 *   它们是 `parseCreateBody` 更早就有的行为，别在这里抄第二份。
 */

import { describe, expect, it } from 'vitest'

import { parseCreateBody } from './book-api.ts'

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    child: {
      childId: 'kid-abc123',
      name: '小宇',
      nameReading: 'xiǎo yǔ',
      ageBand: '4-6',
      lookTags: ['短发'],
      interestTags: ['恐龙'],
    },
    cardId: 'kid-abc123-sheet',
    theme: '勇气',
    form: 'solo',
    ...extra,
  }
}

function valueOf(extra: Record<string, unknown>) {
  const parsed = parseCreateBody(body(extra))
  if (!parsed.ok) throw new Error(`本该通过，却报了：${parsed.problems.join('；')}`)
  return parsed.value
}

describe('voiceId：配音这条线接上没有', () => {
  it('带音色：原样过（这一本会有朗读）', () => {
    expect(valueOf({ voiceId: 'longjielidou_v3.6' }).voiceId).toBe('longjielidou_v3.6')
  })

  it('★ 不带音色也是**合法**的：这一本不配音，引擎会如实说"没有朗读"', () => {
    // 不合法的话，"关掉朗读"那个开关根本发不出请求——而它是个正常选项
    expect('voiceId' in valueOf({})).toBe(false)
  })

  it('空串按"没填"处理，不当成一个空音色送去要 TTS', () => {
    expect('voiceId' in valueOf({ voiceId: '   ' })).toBe(false)
  })

  it('★ 真克隆出来的那条 id 要过：厂商回的是 68 字，原来那条 64 的线把它拦下来了', () => {
    // 形状照抄实测（`.out/voice-id-shape.mts`）：模型名 + prefix + 32 位随机
    const cloned = `qwen-audio-3.0-tts-flash-xiaozhujue-${'a1b2c3d4e5f60718293a4b5c6d7e8f90'}`
    expect(cloned.length).toBe(68)
    expect(valueOf({ voiceId: cloned }).voiceId).toBe(cloned)
  })

  it('★ 太长要拦住：那个长度必然是别的字段串进来了', () => {
    // 放过去的话，报回来的错是"音色不存在"，与真正的问题（表单串了）隔着两层
    const parsed = parseCreateBody(body({ voiceId: 'v'.repeat(129) }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problems.join()).toContain('音色 id 太长')
  })

  it('★ 串了字段要拦住：判据是**字符集**，不是长度', () => {
    // 一个串了字段的字符串里一定会带空格 / 引号 / 中文，而它在 128 字以内
    const parsed = parseCreateBody(body({ voiceId: '我的声音 小宇' }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problems.join()).toContain('不该有的字符')
  })
})

describe('status：草稿还是成品', () => {
  it('运行视图发 draft，原样过', () => {
    expect(valueOf({ status: 'draft' }).status).toBe('draft')
  })

  it('★ 不传就**不写这个字段**——缺省 = 成品（那条迁移决定）', () => {
    // 写成 `?? 'draft'` 的话，script 与老调用方做出来的书会全部变成草稿，
    // 而它们从来没有过"确定生成"这一步，于是永远翻不了身
    expect('status' in valueOf({})).toBe(false)
  })

  it('认不出来的值要拦住，不许静默当成成品', () => {
    const parsed = parseCreateBody(body({ status: 'published-ish' }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problems.join()).toContain('status')
  })
})

/**
 * 孩子的**性别**（2026-10-16）。
 *
 * ★ 这一节存在的理由与上面 `voiceId` 那节是同一个形状，只是更贵：
 *   用户的原话是「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」。
 *   根因是**逐页 prompt 里从来就没有那个称呼**——它在界面上选了、
 *   但请求体的这张表里没有它，于是引擎收到的永远是 `undefined`，
 *   模型只能按头发长短自己猜。
 * ★ 三条：带了要过、不带也要过（老档案与示例孩子都没有这一栏）、
 *   带了乱七八糟的值要**拦住**而不是静默丢掉（丢掉的表现正是"选了没用"）。
 */
describe('gender：它决定模型画男孩还是女孩', () => {
  const withChild = (childExtra: Record<string, unknown>) =>
    parseCreateBody({
      ...body(),
      child: { ...(body()['child'] as Record<string, unknown>), ...childExtra },
    })

  it('选了男孩子：原样进孩子的 profile', () => {
    const parsed = withChild({ gender: 'boy' })
    if (!parsed.ok) throw new Error(parsed.problems.join('；'))
    expect(parsed.value.child.gender).toBe('boy')
  })

  it('★ 不选也是合法的（老档案没有这一栏），且**不写这个字段**', () => {
    const parsed = withChild({})
    if (!parsed.ok) throw new Error(parsed.problems.join('；'))
    // 写成一个空串或 undefined 的话，`childWordOf` 会把它当成"选过"，比不写更坏
    expect('gender' in parsed.value.child).toBe(false)
  })

  it('★ 认不出来的值要拦：静默丢掉的表现，正好是用户看到的那样——选了没用', () => {
    const parsed = withChild({ gender: 'male' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problems.join()).toContain('性别只能是 boy / girl')
  })
})
