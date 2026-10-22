/**
 * thinking.test.ts —— "关思考"那个词，两家写法不同（2026-10-21）
 *
 * 这一组守的是一件不对称的事：**写错字段名两家都不报错**。
 * 请求照发、200 照回，只是思考一直开着——每轮先想几千 token，
 * 而症状是"慢、贵、而且 `temperature` 被静默忽略"（DeepSeek 文档原话：
 * 设置不报错、也不生效）。所以判据只能是"发出去的字段对不对"。
 */

import { describe, expect, it } from 'vitest'

import { isDeepSeek, thinkingOffOf, visionThinkingOffOf } from './thinking.ts'

describe('thinkingOffOf · 文本那条路', () => {
  it('DeepSeek 用文档里的 thinking 对象（它的默认是**开**，不发就等于开着）', () => {
    expect(thinkingOffOf('deepseek-flash')).toEqual({ thinking: { type: 'disabled' } })
  })

  it('百炼 qwen 系沿用 enable_thinking（2026-10-13 实测的那个字段）', () => {
    expect(thinkingOffOf('qwen3.8-flash')).toEqual({ enable_thinking: false })
  })

  it('认不出的模型名沿用 enable_thinking——换一个没量过的字段名要有理由', () => {
    expect(thinkingOffOf('some-unknown-model')).toEqual({ enable_thinking: false })
    // 前缀判据是窄的：`deepseek`（没有横线）不算，避免把同名前缀的别家塞进这条分支
    expect(thinkingOffOf('deepseek')).toEqual({ enable_thinking: false })
  })

  it('模型名大小写不敏感（配置里手写的名字不该变成另一种行为）', () => {
    expect(isDeepSeek('DeepSeek-Flash')).toBe(true)
    expect(thinkingOffOf('  deepseek-flash  ')).toEqual({ thinking: { type: 'disabled' } })
  })
})

describe('visionThinkingOffOf · 视觉那条路', () => {
  it('DeepSeek 要显式关：它的默认是开（effort 还是 high），每张图都会先想一遍', () => {
    expect(visionThinkingOffOf('deepseek-flash')).toEqual({ thinking: { type: 'disabled' } })
  })

  it('★ 其他家**一个字段都不发**——那条路本来就在正常工作', () => {
    // 这不是"两家写法不同"，是"只有我们知道默认值对我们是错的那一家才要写"：
    //   给 kimi-k2.6 那条已经量过的路顺手加一个 `enable_thinking:false`，
    //   收益是零，而它改的是一个有实测记录的行为（那一串 4096 预算的读数）
    expect(visionThinkingOffOf('kimi-k2.6')).toEqual({})
    expect(visionThinkingOffOf('qwen3.8-flash')).toEqual({})
  })
})
