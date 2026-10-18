/**
 * gateways.test.ts —— 「厂商 / 网关」那张地址簿的判据（2026-10-18）
 *
 * 这一层值得测的只有一件事：**这张表里不许出现我们没打算承诺的东西**。
 * 所以三条判据都朝向"少写"而不是"多写"：
 *
 * 1. **一个模型 id 都不许有**——仓库那条验收是「全仓库零个硬编码模型 id」，
 *    而这张表正是最容易破例的地方（"顺手带一个默认模型多方便"）。
 * 2. **按能力分的那一半要真的分住**：语音那一张卡里不许出现 OpenAI 兼容那几家
 *    （地址不同源，选它必然 404）；反过来，只做文字的那一家（DeepSeek）
 *    不许出现在图像那一张卡里。
 * 3. **认得出自己**：当前地址与某条预设一致（含尾斜杠那种写法）时，
 *    下拉要停在那一家的名字上，而不是跳回「自定义」。
 */

import { describe, expect, it } from 'vitest'

import { CUSTOM_GATEWAY_ID, GATEWAYS, gatewayOf, gatewaysFor } from './gateways.ts'

describe('地址簿本身', () => {
  it('每一条要么没有地址（自定义），要么是一个 http(s) 地址', () => {
    for (const item of GATEWAYS) {
      if (item.id === CUSTOM_GATEWAY_ID) {
        expect(item.baseUrl).toBe('')
        continue
      }
      expect(item.baseUrl, item.name).toMatch(/^https?:\/\/\S+$/)
      // 尾斜杠会让"认得出自己"那一半失效（见 `gatewayOf`），所以不写它
      expect(item.baseUrl.endsWith('/'), item.name).toBe(false)
    }
  })

  it('★ 一个模型 id 都没有：这条表只带地址', () => {
    // 判据写在"键"上：多一个 `model` / `models` / `defaultModel` 之类的字段就红。
    // ★ 不按字符串猜（"名字里有没有 qwen"那种写法会误伤 `dall-e-3` 也会漏掉新模型名），
    //   而是把"这张表的形状"钉死——这正是"顺手加一个默认模型"的唯一入口
    for (const item of GATEWAYS) {
      expect(Object.keys(item).sort(), item.name).toEqual(
        item.note === undefined
          ? ['baseUrl', 'id', 'name', 'serves']
          : ['baseUrl', 'id', 'name', 'note', 'serves'],
      )
    }
  })

  it('id 不重复，「自定义」只有一条', () => {
    const ids = GATEWAYS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id === CUSTOM_GATEWAY_ID)).toHaveLength(1)
  })

  it('每一条都至少服务一项能力', () => {
    for (const item of GATEWAYS) {
      expect(item.serves.length, item.name).toBeGreaterThan(0)
    }
  })
})

describe('按能力过滤（gatewaysFor）', () => {
  it('「自定义」永远在最后一条，四条能力都能选到它', () => {
    for (const capability of ['text', 'image', 'vision', 'speech'] as const) {
      const list = gatewaysFor(capability)
      expect(list.at(-1)?.id, capability).toBe(CUSTOM_GATEWAY_ID)
    }
  })

  it('★ 语音那一张只出百炼语音那一条 + 自定义', () => {
    // OpenAI 兼容那几家的地址不是语音那一路用的（`qwen-speech.ts` 文件头第 1 条）
    expect(gatewaysFor('speech').map((item) => item.id)).toEqual([
      'dashscope-tts',
      CUSTOM_GATEWAY_ID,
    ])
  })

  it('★ 图像那一张里没有只做文字的那一家', () => {
    // 参考截图里那一格填的是 DeepSeek + dall-e-3——那种组合只会 404
    const imageIds = gatewaysFor('image').map((item) => item.id)
    expect(imageIds).not.toContain('deepseek')
    expect(imageIds).not.toContain('dashscope-tts')
    expect(imageIds).not.toContain('ark')
  })

  it('文字那一张里最多（常见的那几家都在）', () => {
    const textIds = gatewaysFor('text').map((item) => item.id)
    for (const id of [
      'openai',
      'deepseek',
      'zhipu',
      'dashscope',
      'moonshot',
      'siliconflow',
      'ark',
    ]) {
      expect(textIds, id).toContain(id)
    }
  })
})

describe('认得出自己（gatewayOf）', () => {
  it('地址一致就停在那一家的名字上', () => {
    expect(gatewayOf('https://api.deepseek.com/v1', 'text').id).toBe('deepseek')
    expect(gatewayOf('https://dashscope.aliyuncs.com/api/v1', 'speech').id).toBe('dashscope-tts')
  })

  it('尾斜杠、首尾空格不算差别', () => {
    expect(gatewayOf('  https://api.openai.com/v1/  ', 'text').id).toBe('openai')
  })

  it('认不出就是「自定义」，而且**绝不**猜一个近似值', () => {
    // 站长自己那份聚合站地址不在表里——那时该显示「自定义」，
    // 猜成"最像的那一家"会让他以为下拉里选中的就是当前在用的那个（其实是别的地址）
    expect(gatewayOf('https://tokenrhythm.studio/v1', 'text').id).toBe(CUSTOM_GATEWAY_ID)
    expect(gatewayOf('', 'text').id).toBe(CUSTOM_GATEWAY_ID)
  })

  it('★ 不会跨能力认亲：百炼的兼容地址在语音那一张里是「自定义」', () => {
    // 同一个域名两条记录（compatible-mode 与 /api/v1），按能力分开认
    expect(gatewayOf('https://dashscope.aliyuncs.com/compatible-mode/v1', 'speech').id).toBe(
      CUSTOM_GATEWAY_ID,
    )
  })
})
