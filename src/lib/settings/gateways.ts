/**
 * settings/gateways.ts —— 「厂商 / 网关」那一栏的地址簿（2026-10-18）
 *
 * 站长的原话是「在站长的管理端，模型选择可以弄成这样的」（四张参考截图）。
 * 其中一栏是「厂商 / 网关」：选一家，接口地址就不用自己抄了。
 * 换一家手抄 base URL 的坏法很具体——抄错一个字母，保存是成功的，
 * 一直到真的生成一本书才以 404 的面目出现，而那时候已经过了几页十几秒的出图。
 *
 * 一个文件只放一张表，因为这张表有三条纪律，三条都靠"只有一处"才守得住：
 *
 * 1. 只带地址，不带模型名。 仓库那条验收是「全仓库零个硬编码模型 id」
 *    （README §二），而"哪几个模型能干哪件事"是厂商侧的知识——写进界面
 *    就是第二份会过期的清单。模型名照旧手填，或者点「拉取模型列表」从
 *    `{接口地址}/models` 里挑（`model-list.ts`）。
 *    `gateways.test.ts` 把这一条钉住了。
 *
 * 2. ★ 这些地址是照各家文档抄的，本仓没有逐个实测过。 唯一在这一仓里
 *    真跑过的是聚合站那一家（`tokenrhythm.studio`，见 `.env.example` 与
 *    `docs/tech-selection.md`），而它的地址是站长自己配的那一份，
 *    不在这张表里（当前地址认不出时下拉就显示「自定义」，这是对的）。
 *    所以界面上一律跟着一句：选完点「测试连通」就知道通不通——
 *    这张表是地址书签，不是背书。
 *
 * 3. 按能力分（`serves`）。同一家在不同能力上的地址不是同一个：
 *    语音那一路走的是阿里云百炼的 `/api/v1/services/audio/tts/…`
 *    （`qwen-speech.ts` 文件头第 1 条，写错地址会被 `requireUrl` 的
 *    `pathPrefix` 拦下），把它混在 OpenAI 兼容那几家中间，
 *    就是让人选一个必然 404 的地址。
 *
 * 为什么放在 `lib/settings/`：与 `model-config-state.ts` 同一条分工
 *   ——纯数据、能在 node 里跑、能被测试钉住，而且浏览器那一侧要直接读它
 *   （下拉就在浏览器里）。放进 `model-config.ts` 会把 provider 注册表拖进管理页的 bundle。
 */

import type { Capability } from './model-config-state.ts'

export type Gateway = {
  id: string
  /** 下拉里显示的那一行 */
  name: string
  /** 选中之后填进「接口地址」那一格的值。★ 「自定义」是空串（它表示"别动我的格子"） */
  baseUrl: string
  /** 这一家在哪几项能力上能用（见文件头第 3 条） */
  serves: readonly Capability[]
  /** 选它之后多给一句（地址的特殊写法、这一家的注意事项）。可空 */
  note?: string
}

/** 「自定义」那一条的 id。★ 它不是"另一家厂商"，是"别动我的格子" */
export const CUSTOM_GATEWAY_ID = 'custom'

/**
 * 地址簿。★ 按「哪几家最常见」排，不是按偏好排——这张表不带推荐的意思。
 *
 * 火山方舟（豆包）那一家的图像地址故意不列：它的图像接口要的是
 *   "推理接入点 id"而不是模型名，而我们这一格填的是模型名——
 *   列上去等于教人填一个必然 404 的值。文字与视觉那两项它是 OpenAI 兼容的，照列。
 * OpenAI 的 `/v1` 与 DeepSeek 的 `/v1` 都带 `/v1`：聚合站那一家也是这个形状
 *   （`.env.example` 里 `LLM_BASE_URL=https://tokenrhythm.studio/v1`），
 *   而 `requireUrl` 只补协议、不补路径段——地址写全是我们这侧的约定。
 */
export const GATEWAYS: readonly Gateway[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    serves: ['text', 'image', 'vision'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（OpenAI 兼容）',
    baseUrl: 'https://api.deepseek.com/v1',
    // 这一家只有文字：它没有图像接口，也没有读图的模型。
    //   参考截图里那一格填的是 DeepSeek + `dall-e-3`——那种组合打过去只会 404，
    //   而这里按 `serves` 过滤之后，图像那张卡的下拉里根本不会出现它
    serves: ['text'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM（BigModel）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    serves: ['text', 'image', 'vision'],
    note: '地址末尾是 /v4，不是 /v1——照它的文档抄，别顺手改成 /v1。',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼（通义）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    serves: ['text', 'image', 'vision'],
    note: '这一条是**兼容模式**的地址；语音那一项要的是另一条（下面那一条）。',
  },
  {
    id: 'dashscope-tts',
    name: '阿里云百炼（语音合成）',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    serves: ['speech'],
    // ★ 这句是实测撞出来的（`qwen-speech.ts` 文件头）：写成域名根会所有请求 404，
    //   而 `requireUrl` 的 pathPrefix 会在保存时就把这句话说出来
    note: '语音那一路要写到 /api/v1 为止（资源段是 /services/audio/tts/…）。',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    serves: ['text', 'vision'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    serves: ['text', 'image', 'vision'],
  },
  {
    id: 'ark',
    name: '火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    serves: ['text', 'vision'],
    note: '地址末尾是 /api/v3。图像那一项没有列——它要的是接入点 id，不是模型名。',
  },
  {
    id: CUSTOM_GATEWAY_ID,
    name: '自定义',
    baseUrl: '',
    serves: ['text', 'image', 'vision', 'speech'],
  },
]

/** 这个能力能选的那几条（预设在前，「自定义」永远在最后） */
export function gatewaysFor(capability: Capability): readonly Gateway[] {
  const hits = GATEWAYS.filter(
    (item) => item.id !== CUSTOM_GATEWAY_ID && item.serves.includes(capability),
  )
  const custom = GATEWAYS.find((item) => item.id === CUSTOM_GATEWAY_ID)
  return custom ? [...hits, custom] : hits
}

/**
 * 当前地址对应哪一条（认不出就是「自定义」）。
 *
 * ★ 比较时尾斜杠不算差别（`https://x/v1/` 与 `https://x/v1` 是同一家）：
 *   不归一化的话，站长保存过一次带尾斜杠的地址，下拉就会跳回「自定义」，
 *   而他明明选的就是那一家——看起来像"选了个没用的东西"。
 */
export function gatewayOf(baseUrl: string, capability: Capability): Gateway {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const found = gatewaysFor(capability).find(
    (item) => item.baseUrl !== '' && item.baseUrl.replace(/\/+$/, '') === normalized,
  )
  const custom = GATEWAYS.find((item) => item.id === CUSTOM_GATEWAY_ID)
  // `custom` 一定在表里，这里只是为了类型；真缺了也不该抛在渲染里
  return found ?? custom ?? { id: CUSTOM_GATEWAY_ID, name: '自定义', baseUrl: '', serves: [] }
}
