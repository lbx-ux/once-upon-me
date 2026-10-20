import { describe, expect, it } from 'vitest'
import {
  array,
  enumOf,
  extractJson,
  formatFailures,
  number,
  object,
  optional,
  parseWith,
  string,
  stringList,
  withDefault,
} from './schema.ts'
import { MOODS } from '../engine/domain.ts'
import { asPlanDraft, planDraftCodec } from './story.ts'

describe('object.parse', () => {
  const codec = object({ name: string({ min: 2 }), age: number({ min: 3, max: 12 }) })

  it('错误带**路径** —— 重试提示里没有路径就等于让模型重新猜', () => {
    const result = codec.parse({ name: 'a', age: 99 }, '')
    if (result.ok) throw new Error('应当失败')
    expect(result.failures.map((f) => f.path).sort()).toEqual(['age', 'name'])
  })

  it('嵌套路径用点号，数组用方括号', () => {
    const nested = object({ pages: array(object({ body: stringList({ min: 1 }) })) })
    const result = nested.parse({ pages: [{ body: ['ok'] }, { body: [] }] }, '')
    if (result.ok) throw new Error('应当失败')
    expect(result.failures[0]?.path).toBe('pages[1].body')
  })

  it('一次报全所有问题，不是遇一个就返回', () => {
    const result = codec.parse({ nope: 1 }, '')
    if (result.ok) throw new Error('应当失败')
    expect(result.failures).toHaveLength(2)
  })
})

describe('describe() —— 同一份定义的两个用途', () => {
  it('optional 字段不进 required（否则模型被要求填一个我们允许空的东西）', () => {
    const codec = object({ a: string(), b: optional(string()) })
    const schema = codec.describe() as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required).toEqual(['a'])
    expect(Object.keys(schema.properties)).toEqual(['a', 'b'])
  })

  it('additionalProperties: false —— 模型多写的字段不该被当成通过', () => {
    expect(object({ a: string() }).describe()).toMatchObject({ additionalProperties: false })
  })

  /**
   * `stringList` 的条数上下界要发出去（2026-10-20 补的）。
   *
   *   在它之前，`parse()` 一直用 `countCheck` 卡着 `opts.min` / `opts.max`
   *   （`body` 是 1–4 条），而 `describe()` 一个都不发——于是喂给模型的那份 schema
   *   比我们验收的那份松一格：模型交了 5 条，会被判 `数量过多（5 > 4）`，
   *   而它从来没有被告知上限是 4。文件头那句"分成两份定义迟早会漂"，说的就是这种漂。
   *   同一个文件里 `array().describe()` 一直发着这两个键（`nodes` 就靠它拿到
   *     `minItems: 3, maxItems: 40`），所以这一条其实是补一处不一致，不是加规矩。
   */
  it('stringList 的 min/max 也发出去，与 array() 一致', () => {
    const list = stringList({ min: 1, max: 4, itemMax: 120 }).describe()
    expect(list).toMatchObject({ minItems: 1, maxItems: 4 })
    expect(array(string(), { min: 3, max: 40 }).describe()).toMatchObject({
      minItems: 3,
      maxItems: 40,
    })
  })

  it('没给上下界就不带那两个键（不凭空补一个 0）', () => {
    const bare = stringList({ itemMax: 120 }).describe()
    expect('minItems' in bare).toBe(false)
    expect('maxItems' in bare).toBe(false)
  })

  /**
   * 发出去的那份与真正验收的那份同一个数：交 4 条过、交 5 条不过，
   *   而 schema 里写的正是 4。这条把两者钉在一起——只改一边就会红。
   */
  it('★ 发出去的 maxItems 与 parse 真正卡住的条数是同一个数', () => {
    const codec = stringList({ min: 1, max: 4 })
    const schema = codec.describe() as { maxItems: number }
    expect(
      codec.parse(
        Array.from({ length: schema.maxItems }, () => '句'),
        '',
      ).ok,
    ).toBe(true)
    const over = codec.parse(
      Array.from({ length: schema.maxItems + 1 }, () => '句'),
      '',
    )
    expect(over.ok).toBe(false)
  })
})

describe('enumOf', () => {
  const mood = enumOf(MOODS)

  it('大小写与空格宽容（模型爱写 Calm，这是事实）', () => {
    expect(mood.parse(' Calm ', 'mood')).toEqual({ ok: true, value: 'calm' })
  })

  it('换词不宽容：happy 不是 joy 的同义词，它是换了判据', () => {
    const result = mood.parse('happy', 'mood')
    expect(result.ok).toBe(false)
  })
})

describe('withDefault', () => {
  it('缺字段用默认值，不报错 —— 别为一个 mood 重跑整本', () => {
    const codec = withDefault(enumOf(MOODS), 'calm')
    expect(codec.parse(undefined, 'mood')).toEqual({ ok: true, value: 'calm' })
    expect(codec.parse('nonsense', 'mood')).toEqual({ ok: true, value: 'calm' })
  })
})

describe('extractJson', () => {
  it('从 ```json 围栏与寒暄里抠出对象', () => {
    const text = '好的，这是你要的分镜：\n```json\n{"title":"云","nodes":[]}\n```\n希望满意。'
    expect(extractJson(text)).toEqual({ title: '云', nodes: [] })
  })

  it('嵌套同种括号不被提前闭合', () => {
    expect(extractJson('前 {"a":{"b":{"c":1}}} 后')).toEqual({ a: { b: { c: 1 } } })
  })

  it('字符串里的大括号不算数', () => {
    expect(extractJson('{"a":"}{"}')).toEqual({ a: '}{' })
  })

  it('没有 JSON 时返回 null 而不是抛', () => {
    expect(extractJson('抱歉，我无法完成这个请求。')).toBeNull()
  })
})

describe('planDraftCodec —— 判据 1 的那四个字段', () => {
  const goodNode = {
    scene: '草地上小宇抬头看云',
    body: ['云变成了一条恐龙的背。'],
    imagePrompt: '午后草地，孩子仰头',
    mood: 'wonder',
  }

  it('四个必填齐了就通过，树形字段可以全省（独读版就是全不填）', () => {
    const result = parseWith(
      planDraftCodec,
      JSON.stringify({ title: '小宇的云', nodes: [goodNode, goodNode, goodNode] }),
    )
    expect(result.ok).toBe(true)
  })

  it('少一个 body 就报出 pages 路径，供重试提示引用', () => {
    const broken = { ...goodNode } as Record<string, unknown>
    delete broken['body']
    const result = parseWith(
      planDraftCodec,
      JSON.stringify({ title: '小宇的云', nodes: [broken, goodNode, goodNode] }),
    )
    if (result.ok) throw new Error('应当失败')
    expect(result.failures[0]?.path).toContain('nodes[0].body')
    expect(formatFailures(result.failures)).toContain('- nodes[0].body')
  })

  it('少于 3 页直接拒（那不是绘本，是一页卡片）', () => {
    const result = parseWith(planDraftCodec, JSON.stringify({ title: 't', nodes: [goodNode] }))
    expect(result.ok).toBe(false)
  })

  it('正文里的空串被丢掉，全空则算数量不足（空气泡不能印在页上）', () => {
    const result = parseWith(
      planDraftCodec,
      JSON.stringify({
        title: 't',
        nodes: [{ ...goodNode, body: ['  ', ''] }, goodNode, goodNode],
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('校验过的对象能收窄成 PlanDraft 供 tree 使用', () => {
    const result = parseWith(
      planDraftCodec,
      JSON.stringify({ title: '小宇的云', nodes: [goodNode, goodNode, goodNode] }),
    )
    if (!result.ok) throw new Error('应当通过')
    const plan = asPlanDraft(result.value)
    expect(plan.title).toBe('小宇的云')
    expect(plan.nodes[0]?.mood).toBe('wonder')
    expect(plan.nodes[0]?.from).toBeUndefined()
  })
})
