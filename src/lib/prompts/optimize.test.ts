/**
 * optimize.test.ts —— 「优化这句话」里我们自己写的那部分
 *
 * 边界先说清楚：LLM 会回什么不可测，写断言等于把"测过"变成一个假的数
 *   （工单 07 §四 那条）。所以这里一个字都没测模型的输出。
 *   测的是包住它的那圈代码：`cleanSuggestion` 的清洗规则、长度怎么数、
 *   缺字段时提示词里不写占位、以及提示词里的那个数字与常量不许各自漂移。
 *
 * 下面几条清洗用例都是真会回来的形状，不是想象出来的边界：
 *   模型被要求"只输出那一句"，但它仍然会包围栏、加"优化后："、用引号把整句圈起来。
 *   每一条如果没处理，用户看到的就是一句带 ``` 或带标签的"建议"。
 */

import { describe, expect, it } from 'vitest'

import {
  cleanSuggestion,
  isTooLong,
  OPTIMIZE_MAX_CHARS,
  optimizeRequest,
  optimizeSystem,
  optimizeUser,
  suggestionLength,
} from './optimize.ts'

describe('cleanSuggestion 把回复收拾成一句', () => {
  it('剥掉围栏', () => {
    expect(cleanSuggestion('```\n朵朵把月亮送回天上。\n```')).toBe('朵朵把月亮送回天上。')
    expect(cleanSuggestion('```text\n朵朵把月亮送回天上。')).toBe('朵朵把月亮送回天上。')
  })

  it('剥掉行首标签与序号', () => {
    expect(cleanSuggestion('优化后：朵朵把月亮送回天上。')).toBe('朵朵把月亮送回天上。')
    expect(cleanSuggestion('1. 朵朵把月亮送回天上。')).toBe('朵朵把月亮送回天上。')
  })

  it('剥掉整句外面那一对引号与书名号', () => {
    expect(cleanSuggestion('“朵朵把月亮送回天上。”')).toBe('朵朵把月亮送回天上。')
    expect(cleanSuggestion('「朵朵把月亮送回天上。」')).toBe('朵朵把月亮送回天上。')
    expect(cleanSuggestion('《朵朵把月亮送回天上。》')).toBe('朵朵把月亮送回天上。')
  })

  it('引号里套标签、标签里套引号，两种都剥得掉', () => {
    expect(cleanSuggestion('“优化后：朵朵把月亮送回天上。”')).toBe('朵朵把月亮送回天上。')
    expect(cleanSuggestion('优化后：“朵朵把月亮送回天上。”')).toBe('朵朵把月亮送回天上。')
  })

  it('★ 首尾是引号、句子中间还有引号时，宁可不剥也不腰斩', () => {
    // 这种形状剥哪一边都说得通，而"剥错"的结果是把句子切坏且看起来仍然像一句正常话
    // （`"a" 与 "b"` → `a" 与 "b`）。于是规则是：整句正好一对才剥。
    // 代价是偶尔留下一对可见的引号——那比切错字轻得多，而且用户看得见，
    // 看不见的那个才叫 bug
    const wrapped = '"他喊"月亮"然后跑开。"'
    expect(cleanSuggestion(wrapped)).toBe(wrapped)
    expect(cleanSuggestion('"朵朵" 与 "月亮"')).toBe('"朵朵" 与 "月亮"')
    // 而真正"整句被包了一对"的那种（模型最常见的写法），照样剥得掉
    expect(cleanSuggestion('"朵朵抱着月亮。"')).toBe('朵朵抱着月亮。')
  })

  it('换行合成一句，中文字之间不留空格（标点后那个空格是排版伤）', () => {
    expect(cleanSuggestion('朵朵抱着月亮，\n轻轻走过屋顶。')).toBe('朵朵抱着月亮，轻轻走过屋顶。')
    expect(cleanSuggestion('朵朵抱着月亮，  轻轻  走过屋顶。')).toBe('朵朵抱着月亮，轻轻走过屋顶。')
  })

  it('★ 拉丁词之间的空格要留着', () => {
    // 上面那一条只该吃掉中文字之间的空格：`Teddy 熊` 里的那个空格是词距，
    // 一并吃掉就变成 `Teddy熊`——这不是排版的毛病，是把句子写坏了
    expect(cleanSuggestion('朵朵抱着 Teddy 熊 走过屋顶。')).toBe('朵朵抱着 Teddy 熊走过屋顶。')
  })

  it('空回复仍是空（由调用方判成失败，不在本地编一句顶上）', () => {
    expect(cleanSuggestion('')).toBe('')
    expect(cleanSuggestion('   \n  ')).toBe('')
    expect(cleanSuggestion('```\n```')).toBe('')
  })
})

describe('长度按码点算', () => {
  it('一个汉字、一个 emoji 都算 1', () => {
    expect(suggestionLength('朵朵')).toBe(2)
    expect(suggestionLength('🌙')).toBe(1)
    expect(suggestionLength('🌙'.repeat(3))).toBe(3)
  })

  it('★ 边界正好在上限上：80 过、81 不过', () => {
    expect(isTooLong('朵'.repeat(OPTIMIZE_MAX_CHARS))).toBe(false)
    expect(isTooLong('朵'.repeat(OPTIMIZE_MAX_CHARS + 1))).toBe(true)
  })
})

describe('提示词只写真实存在的信息', () => {
  it('没给的名字与主题：整行不出现，不写空占位', () => {
    const text = optimizeUser({ wish: '朵朵抱着月亮' })
    expect(text).toContain('朵朵抱着月亮')
    expect(text).not.toContain('主角的名字')
    expect(text).not.toContain('主题')
    expect(text).not.toContain('undefined')
  })

  it('给了就写进去', () => {
    const text = optimizeUser({ wish: '朵朵抱着月亮', childName: '朵朵', themeLabel: '月亮' })
    expect(text).toContain('主角的名字：朵朵')
    expect(text).toContain('已经挑好的主题：月亮')
  })

  it('原句前后有空格时先 trim，别让模型以为那是有意义的东西', () => {
    // 2026-10-20：原句包进了「」并带了`家长原话`（数据/指令分界），所以判据改成
    //   "引号里就是 trim 过的那一句"——要守的不变式一个字没变（空格进去了就坏），
    //   而"引号里到底有没有多余空白"现在能一眼看出来。
    expect(optimizeUser({ wish: '  朵朵抱着月亮  ' })).toContain('「朵朵抱着月亮」')
  })

  it('★ 原句外面有「」，并且标着`家长原话`（与故事规划那三格同一个手法）', () => {
    const user = optimizeUser({ wish: '朵朵抱着月亮' })
    expect(user).toContain('「朵朵抱着月亮」（家长原话）')
  })
})

describe('提示词与常量不许各自漂移', () => {
  it('system 里的长度上限与 OPTIMIZE_MAX_CHARS 是同一个数', () => {
    // 改了常量却没改提示词的话，模型会按旧长度写，而界面按新长度报"太长了"
    expect(optimizeSystem()).toContain(String(OPTIMIZE_MAX_CHARS))
  })

  it('system 里写明了"只输出那一句"', () => {
    expect(optimizeSystem()).toContain('只输出改好的那一句')
  })

  it('★ 这一路必须带 plainText，而且不许带 jsonSchema', () => {
    // 这条是真炸过之后补的：`LLM_JSON_MODE=object` 下适配器无条件带
    // `response_format:{type:'json_object'}`，而真实网关（LiteLLM）要求 messages 里
    // 出现 "json" 这个词，于是这条纯文本调用直接 400
    // （实测报文见 TextRequest.plainText）。谁把 plainText 删掉，这条会红。
    const request = optimizeRequest({ wish: '想让孩子学会分享' })
    expect(request.plainText).toBe(true)
    expect(request.jsonSchema).toBeUndefined()
    expect(request.system).toBe(optimizeSystem())
    expect(request.user).toBe(optimizeUser({ wish: '想让孩子学会分享' }))
  })

  it('★ 不给 token 预算与超时：那是模型的属性，不是这次调用的属性', () => {
    // 压小预算会让思考模型把整条花在思考链上、正文一个字都不写
    // （`scripts/probe-thinking-budget.mts` 的实测），而超时要压到更低得先有 P95
    expect(optimizeRequest({ wish: '月亮' }).maxTokens).toBeUndefined()
  })
})
