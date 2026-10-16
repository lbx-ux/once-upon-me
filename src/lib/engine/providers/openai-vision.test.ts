/**
 * openai-vision.test.ts —— 视觉比对里那个"先抠出 JSON"的小函数
 *
 * 它今天（2026-10-15）从"自带一段扫描器"改成了"调用 `schemas/schema.ts` 的 `extractJson`"：
 * 两份扫描器是工单 01 量到的**那处真实重复**（ADR-0004 翻案判据的第二条）。
 *
 * ★ 所以这一组用例的重点不是"能不能解析"（那个 `schema.test.ts` 已经覆盖了），
 *   而是**合并有没有改变行为**——尤其是：
 *   回包是一个数组包着一个对象时，老实现能从里面抠出对象，合并后必须还是能。
 *   这条要是丢了，症状是"某个模型每次都判不出分"，而它看起来只是"这家不行"。
 */

import { describe, expect, it } from 'vitest'

import { EngineError } from '../errors.ts'
import { createOpenAiVision } from './openai-vision.ts'
import { anchorsFromAnalysis, lookTagsFromAnalysis, parseLooseJson } from './openai-vision.ts'

describe('parseLooseJson', () => {
  it('裸 JSON 直接解', () => {
    expect(parseLooseJson('{"score":0.8}')).toEqual({ score: 0.8 })
  })

  it('围栏与寒暄都跳过', () => {
    expect(parseLooseJson('我觉得是这样：\n```json\n{"score":0.8}\n```\n以上')).toEqual({
      score: 0.8,
    })
  })

  it('★ 数组包着对象时，从第一个 `{` 起抠出那个对象（老行为，合并后必须保留）', () => {
    expect(parseLooseJson('[{"score":0.8}]')).toEqual({ score: 0.8 })
  })

  it('字符串里的花括号不算深度（这是两份扫描器当初都写对、也都得跟着修的那一段）', () => {
    expect(parseLooseJson('{"reason":"他说\\"这个 { 好玩\\"","score":0.4}')).toEqual({
      reason: '他说"这个 { 好玩"',
      score: 0.4,
    })
  })

  it('没有对象、或者括号不闭合 → null，不抛', () => {
    expect(parseLooseJson('这家什么都没回')).toBeNull()
    expect(parseLooseJson('{"score":')).toBeNull()
    expect(parseLooseJson('[1,2,3]')).toBeNull()
  })
})

/**
 * 读照片那条路（2026-10-15）。
 *
 * ★ 这一组用例守的是"脏输入不许静默进表单"：这一份产物会被**直接填进**家长手上的表单，
 *   然后进 prompt、进每一页插画。所以每一条都不是格式洁癖——
 *   一个自己造的槽位会让 `buildCard` 在出图之后才拒（家长已经看过一张图了），
 *   一个 1 个字的"值"会让那张卡看起来有依据、其实等于没写。
 */
describe('anchorsFromAnalysis', () => {
  it('中文槽位名 → 映射回槽位', () => {
    expect(anchorsFromAnalysis({ 骨相: '圆脸、颊部饱满', 头发: '齐耳短发' })).toEqual([
      { slot: 'bone', value: '圆脸、颊部饱满' },
      { slot: 'hair', value: '齐耳短发' },
    ])
  })

  it('英文键名也认（提示词是「骨相（bone）」这种形式，模型回哪种都行）', () => {
    expect(anchorsFromAnalysis({ bone: '圆脸、颊部饱满' })).toEqual([
      { slot: 'bone', value: '圆脸、颊部饱满' },
    ])
    expect(anchorsFromAnalysis({ '骨相（bone）': '圆脸、颊部饱满' })).toEqual([
      { slot: 'bone', value: '圆脸、颊部饱满' },
    ])
  })

  it('★ 太短的值丢掉：`"圆"` 这种进了锚点等于没写，而它看起来像"读到了"', () => {
    expect(anchorsFromAnalysis({ 骨相: '圆' })).toEqual([])
    // ★ 两个字**不算**太短：「圆脸」「短发」都是合格锚点（第一版门槛写成 3，把它们误杀了）
    expect(anchorsFromAnalysis({ 骨相: '圆脸' })).toEqual([{ slot: 'bone', value: '圆脸' }])
  })

  it('★ 「看不清」丢掉——那是提示词自己要求的哨兵值，不是锚点', () => {
    // 不丢的话它会被当成一条锚点填进表单，然后跟着孩子进每一页（画面里会写"看不清"）
    expect(anchorsFromAnalysis({ 常服: '看不清' })).toEqual([])
    expect(anchorsFromAnalysis({ 常服: '看不清，被挡住了' })).toEqual([])
    expect(anchorsFromAnalysis({ 常服: '未知' })).toEqual([])
    // 而正常的描述照旧过
    expect(anchorsFromAnalysis({ 常服: '芥黄短袖 + 深蓝短裤' })).toEqual([
      { slot: 'wardrobe', value: '芥黄短袖 + 深蓝短裤' },
    ])
  })

  it('认不出来的槽位丢掉，不抛（模型爱自己加"表情"这种格子）', () => {
    expect(anchorsFromAnalysis({ 表情: '在笑', 骨相: '圆脸、颊部饱满' })).toEqual([
      { slot: 'bone', value: '圆脸、颊部饱满' },
    ])
  })

  it('同一个槽位重复出现时只留第一条', () => {
    expect(anchorsFromAnalysis({ 骨相: '圆脸、颊部饱满', bone: '方脸、下颌线硬朗' })).toEqual([
      { slot: 'bone', value: '圆脸、颊部饱满' },
    ])
  })

  it('不是对象、或是数组 → 空表，不抛', () => {
    expect(anchorsFromAnalysis(null)).toEqual([])
    expect(anchorsFromAnalysis('骨相：圆脸')).toEqual([])
    expect(anchorsFromAnalysis([{ slot: 'bone', value: '圆脸' }])).toEqual([])
  })

  it('值不是字符串的丢掉', () => {
    expect(anchorsFromAnalysis({ 骨相: 12, 眼睛: '黑亮杏眼、眼尾上挑' })).toEqual([
      { slot: 'eyes', value: '黑亮杏眼、眼尾上挑' },
    ])
  })
})

describe('lookTagsFromAnalysis', () => {
  it('只保留清单里有的（模型爱造"大眼睛"这种词，而表单里没有那一格）', () => {
    expect(lookTagsFromAnalysis(['短发', '大眼睛', '爱笑'])).toEqual(['短发', '爱笑'])
  })

  it('去重，且不是数组就是空', () => {
    expect(lookTagsFromAnalysis(['短发', '短发'])).toEqual(['短发'])
    expect(lookTagsFromAnalysis('短发')).toEqual([])
    expect(lookTagsFromAnalysis(undefined)).toEqual([])
  })
})

/**
 * 读照片这条路的**坏回包**（2026-10-16）。
 *
 * ★ 这一组存在的理由，就是"线上那一次我复现不出来"：
 *   用户那一屏上写着「没按 JSON 回答（原文前 120 字：）」——括号里是**空的**。
 *   真打 `kimi-k2.6` 三次（`.out/vision-raw-2.log` / `-3.log` / 第一次）三次都成功，
 *   它是**偶发**的（推理模型想完没写）。偶发的东西不能靠"再多打几次"来验，
 *   所以喂假回包：`HttpDeps.fetchImpl` 就是为这件事留的口子（见 http.ts 那段注释）。
 */
describe('analyzePortrait 对坏回包的处理', () => {
  const deps = (replies: unknown[], sent: unknown[]) => ({
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'k',
    fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      const body = replies[Math.min(sent.length - 1, replies.length - 1)]
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const ok = (content: unknown) => ({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  })
  const blank = (extra: Record<string, unknown> = {}) => ({
    choices: [
      {
        finish_reason: 'length',
        message: {
          role: 'assistant',
          content: '',
          reasoning_content: '让我先想想这张照片…',
          ...extra,
        },
      },
    ],
  })

  it('★ 正文空 → **引擎自己再试一次**（界面上"再点一次"那句话原来是把重试推给家长）', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(
      deps([blank(), ok('{"anchors":{"骨相":"方脸、下颌线硬"},"lookTags":[]}')], sent),
      'm',
    )
    const out = await provider.analyzePortrait({ photoDataUrl: 'data:image/png;base64,AA' })
    expect(sent.length).toBe(2)
    expect(out.anchors).toEqual([{ slot: 'bone', value: '方脸、下颌线硬' }])
  })

  it('★ 两次都空 → 抛，且排障原文里**有现场**（不是一个空括号）', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(deps([blank(), blank()], sent), 'm')
    const err = await provider
      .analyzePortrait({ photoDataUrl: 'data:image/png;base64,AA' })
      .then(() => null)
      .catch((e: unknown) => e as EngineError)
    expect(err?.code).toBe('provider-bad-response')
    expect(sent.length).toBe(2)
    expect(err?.message).toContain('正文 0 字')
    expect(err?.message).toContain('finish_reason=length')
    expect(err?.message).toContain('思考链')
    expect(err?.message).toContain('让我先想想这张照片')
  })

  it('正文有字但解析不了 → 照旧带正文前 120 字（这一档原来就有，别被上面那条改坏）', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(
      deps([ok('这家什么都没回'), ok('这家什么都没回')], sent),
      'm',
    )
    const err = await provider
      .analyzePortrait({ photoDataUrl: 'data:image/png;base64,AA' })
      .then(() => null)
      .catch((e: unknown) => e as EngineError)
    expect(err?.message).toContain('正文前 120 字：这家什么都没回')
  })

  it('★ `content` 是分片数组时也要能读出来（老实现只认字符串，遇到这种形状静默回空串）', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(
      deps(
        [
          ok([
            { type: 'text', text: '{"anchors":{"眼睛"' },
            { type: 'text', text: ':"黑亮杏眼"}}' },
          ]),
        ],
        sent,
      ),
      'm',
    )
    const out = await provider.analyzePortrait({ photoDataUrl: 'data:image/png;base64,AA' })
    expect(sent.length).toBe(1)
    expect(out.anchors).toEqual([{ slot: 'eyes', value: '黑亮杏眼' }])
  })

  it('★ 送出去的那份请求：只读七个槽位，且明说「补充」不用读', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(deps([ok('{"anchors":{}}')], sent), 'm')
    await provider.analyzePortrait({
      photoDataUrl: 'data:image/png;base64,AA',
      // 表单里就是八格（含补充那格，值通常是空）
      anchors: [
        { slot: 'bone', value: '圆脸、颊部饱满' },
        { slot: 'extra', value: '' },
        { slot: 'wardrobe', value: '' },
      ],
    })
    const body = sent[0] as { messages: { content: unknown }[] }
    const system = String(body.messages[0]?.content)
    const parts = body.messages[1]?.content as { type: string; text?: string }[]
    const user = parts.map((part) => part.text ?? '').join('\n')
    expect(system).toContain('「补充」那一格**不用你读**')
    expect(user).toContain('骨相（bone）')
    expect(user).not.toContain('补充（extra）')
    // 已填的锚点只送有值的那些（空值没有粒度可参考，补充那一格更不该送）
    expect(user).toContain('bone: 圆脸、颊部饱满')
    expect(user).not.toContain('wardrobe:')
    expect(user).not.toContain('extra:')
  })

  it('★ 提示词里不许再出现预填示例那句话（模型原样抄回来过）', async () => {
    const sent: unknown[] = []
    const provider = createOpenAiVision(deps([ok('{"anchors":{}}')], sent), 'm')
    await provider.analyzePortrait({ photoDataUrl: 'data:image/png;base64,AA' })
    const body = sent[0] as { messages: { content: unknown }[] }
    const system = String(body.messages[0]?.content)
    expect(system).not.toContain('圆脸、颊部饱满、下颌线软')
    expect(system).toContain('不许把我这些字抄进去')
  })
})
