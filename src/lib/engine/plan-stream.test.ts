/**
 * plan-stream.test.ts —— 增量抽取器：**只认已经闭合的东西**
 *
 * 这一组测试的存在理由，就是工单 07 §一.2 那句：
 * "屏幕上闪过的每一个字都必须是模型真的写完的字"。
 *
 * 所以每条用例问的都是同一件事：**半个字段有没有漏出去**。
 * 判据不是"解析得对不对"（不完整的 JSON 本来就不该被解析），
 * 而是"截到这里为止，屏幕上该显示什么、不该显示什么"。
 *
 * ★ 用**逐字截断**的方式扫一遍：把整张故事表按每一个前缀喂进去，
 *   断言"任何时候都不会显示一个还没闭合的字符串"。
 *   一条条手写断点会漏掉真正会出事的那一处（通常是转义字符中间）。
 */

import { describe, expect, it } from 'vitest'

import { readPlanProgress } from './plan-stream.ts'

const PLAN = {
  title: '云上的恐龙',
  nodes: [
    {
      scene: '草地上，小宇抬头看云',
      body: ['云变成了一条恐龙的背。', '他踮起脚，想摸一摸。'],
      imagePrompt: '午后草地，孩子仰头，远处一朵长背脊的云',
      mood: 'wonder',
    },
    {
      scene: '云恐龙低下头',
      body: ['恐龙说：上来吧。'],
      imagePrompt: '云朵俯身贴近草地，孩子伸手',
      mood: 'joy',
    },
    {
      scene: '他站在云背上',
      body: ['风从耳朵旁边跑过去。'],
      imagePrompt: '孩子站在云背上，风吹头发',
      mood: 'wonder',
    },
  ],
}

const RAW = JSON.stringify(PLAN)

describe('readPlanProgress · 完整文本', () => {
  it('整张表念完：标题、每一句正文、页数都对', () => {
    const progress = readPlanProgress(RAW)
    expect(progress.title).toBe('云上的恐龙')
    expect(progress.lines).toEqual([
      '云变成了一条恐龙的背。',
      '他踮起脚，想摸一摸。',
      '恐龙说：上来吧。',
      '风从耳朵旁边跑过去。',
    ])
    expect(progress.pages).toBe(3)
  })

  it('空文本 = 什么都没有（还没开始写）', () => {
    expect(readPlanProgress('')).toEqual({ title: null, lines: [], pages: 0 })
  })

  it('点号、换行、缩进都不影响（不依赖任何排版）', () => {
    expect(readPlanProgress(JSON.stringify(PLAN, null, 2)).pages).toBe(3)
    expect(readPlanProgress(JSON.stringify(PLAN)).lines).toHaveLength(4)
  })
})

describe('readPlanProgress · 半个字段不许露出来', () => {
  it('★ 逐个前缀扫一遍：任何时候都不显示没闭合的字符串', () => {
    const closedSoFar = new Set<string>()
    for (const line of [
      '云变成了一条恐龙的背。',
      '他踮起脚，想摸一摸。',
      '恐龙说：上来吧。',
      '风从耳朵旁边跑过去。',
    ]) {
      closedSoFar.add(line)
    }

    for (let cut = 0; cut <= RAW.length; cut += 1) {
      const progress = readPlanProgress(RAW.slice(0, cut))
      for (const shown of progress.lines) {
        expect(closedSoFar.has(shown)).toBe(true)
      }
      // 标题同理：要么是那个完整的标题，要么还没有
      if (progress.title !== null) expect(progress.title).toBe('云上的恐龙')
      // 页数不会超过文本里真正闭合的节点数
      expect(progress.pages).toBeLessThanOrEqual(3)
    }
  })

  it('截在半句话上：那一句不出现，前面已闭合的照旧', () => {
    // 这一刀切在**第 1 页正文的第二句**中间：所以此时第 1 页自己还没闭合
    const cut = RAW.indexOf('他踮起脚') + 3
    const progress = readPlanProgress(RAW.slice(0, cut))
    expect(progress.lines).toEqual(['云变成了一条恐龙的背。'])
    // 页数是 0 而不是 1：第 1 页的 `}` 还没到。用"看到 scene 就 +1"的实现在这里会是 1，
    // 而那一页的正文随时可能被模型改掉——报出去的页数会往回跳
    expect(progress.pages).toBe(0)
    expect(progress.title).toBe('云上的恐龙')
  })

  it('★ 已经显示出来的句子，后面再来的字不会改动它（前缀稳定）', () => {
    const cuts = [RAW.indexOf('恐龙说') + 2, RAW.indexOf('恐龙说') + 20, RAW.length]
    const seen: string[][] = cuts.map((cut) => [...readPlanProgress(RAW.slice(0, cut)).lines])
    // 每往后一段，前面那几句必须一字不变（只允许在后面追加）
    expect(seen[1]?.slice(0, seen[0]?.length ?? 0)).toEqual(seen[0])
    expect(seen[2]?.slice(0, seen[1]?.length ?? 0)).toEqual(seen[1])
  })

  it('页数按"节点对象闭合"算，不按"看到 scene 键"算', () => {
    // 第 2 页刚写出 scene 的键、值还没闭合
    const cut = RAW.indexOf('云恐龙低下头') + 4
    const progress = readPlanProgress(RAW.slice(0, cut))
    expect(progress.pages).toBe(1)
    // 用"看到 scene 就 +1"的实现，这里会是 2——多报的那一页随时可能被模型改掉
  })
})

describe('readPlanProgress · 转义与坏输入', () => {
  it('转义解成真字符：换行、引号', () => {
    const raw = JSON.stringify({
      title: '云上的"恐龙"',
      nodes: [
        {
          scene: 's',
          body: ['第一行\n第二行', '他说："好高"'],
          imagePrompt: 'p'.repeat(8),
          mood: 'joy',
        },
      ],
    })
    const progress = readPlanProgress(raw)
    // ★ 原始 JSON 里这两句是 `\n` 与 `\"`，屏幕上要显示真字符——
    //   不解转义的话，孩子会看到「第一行\n第二行」这种反斜杠
    expect(raw).toContain('\\n')
    expect(raw).toContain('\\"')
    expect(progress.title).toBe('云上的"恐龙"')
    expect(progress.lines[0]).toBe('第一行\n第二行')
    expect(progress.lines[1]).toBe('他说："好高"')
  })

  it('坏转义丢掉那一句，其余照旧，而且不抛', () => {
    // \q 不是合法转义：这一句解不开 → 丢掉
    const raw = '{"title":"好","nodes":[{"body":["正常的一句","坏\\q句子"],"scene":"s"}]}'
    const progress = readPlanProgress(raw)
    expect(progress.lines).toEqual(['正常的一句'])
  })

  it('模型先吐围栏或解释文字，也不影响抽取', () => {
    const raw = `好的，这是故事表：\n\`\`\`json\n${RAW}\n\`\`\``
    expect(readPlanProgress(raw).pages).toBe(3)
  })

  it('标题不是第一层的那一个就不算（嵌套对象里的同名键不冒充标题）', () => {
    const raw = '{"nodes":[{"title":"某页里的小标题","scene":"s"}],"title":"真标题"}'
    const progress = readPlanProgress(raw)
    expect(progress.title).toBe('真标题')
  })
})
