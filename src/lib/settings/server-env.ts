/**
 * settings/server-env.ts —— ★ 密钥的唯一来源（工单 05）
 *
 * 上一轮这一份是从请求体里来的（已删除的 `request-env.ts` 的 `envFromBody`）：用户在
 * 「模型与密钥」抽屉里填 key，每个请求把它带上来（ADR-0008）。
 * 这一轮反过来（ADR-0009）：密钥由站长分配，只从服务端环境来。
 *
 * 这一层与 `toEnv()`（原来在已删除的 `settings/state.ts`）是同一件事的两个时代：
 * 那时它是"用户填的表 → env 表"，现在是"`process.env` → env 表"。
 * 规矩一条没变，而且必须一条不变，因为下游（`engine/providers/registry.ts`）
 * 认的就是那张表的形状：
 *
 *   · 值剪掉前后空白：复制粘贴带一个尾空格，是最常见的一种"key 明明对却 401"；
 *   · 空串不写进表：registry 对空串与缺位的处理一样，但"表里有个空串"
 *     会让排障时误以为配过了（这条是原来那段注释里的原话，它救过一次排障）；
 *   · 视觉（`VISION_*`）**不回落到 `LLM_*`**，图像也不回落——接口形状不同，
 *     回落只会把"配置错了"变成一个运行期 400。
 *
 * 环境变量名一个都没改：`.env.local` 里那几行今天就是生产配置，
 * 所以"把密钥搬到服务端"这件事没有一次配置迁移。改的只是它从哪儿读。
 */

import type { Env } from '@/lib/engine/providers/registry.ts'
import { readOverrides } from './runtime-config.ts'

/**
 * 从 `process.env` 取的那几项。写全，不写成 `startsWith('LLM_')` 那种：
 * 通配看起来省事，实际上会把 `LLM_TIMEOUT_MS`（一个数）与 `LLM_API_KEY`（一个秘密）
 * 一视同仁地送进引擎，而将来某个 `LLM_DEBUG_DUMP=1` 会被悄悄带进去。
 */
const KEYS = [
  // 文本（写故事）
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_JSON_MODE',
  'LLM_MAX_TOKENS',
  'LLM_THINKING',
  'LLM_TIMEOUT_MS',
  // 图像（画插画）
  'IMAGE_BASE_URL',
  'IMAGE_API_KEY',
  'IMAGE_MODEL',
  'IMAGE_TIMEOUT_MS',
  'IMAGE_UNIT_COST_CNY',
  // ★ 2026-10-22 补：换到 qwen-image-3.0 之后新增的旋钮。漏在这里的表现是
  //   `.env.local` 里配了、`registry.ts` 也认，但中间这张白名单把它静默丢掉——
  //   于是"提示词改写开着"变成"其实是关的"，而两边都不会报错。
  //   （`IMAGE_SUPPORTS_REFERENCE` 已随能力推导删除，不再抄进这张表。）
  'IMAGE_PROMPT_EXTEND',
  // 视觉（核对形象）
  'VISION_BASE_URL',
  'VISION_API_KEY',
  'VISION_MODEL',
  'VISION_TIMEOUT_MS',
  'VISION_MAX_TOKENS',
  // 比对与画面审核各自那一格预算（`openai-vision.ts` 的三个旋钮）
  'VISION_COMPARE_MAX_TOKENS',
  'VISION_SAFETY_MAX_TOKENS',
  // 语音（朗读）
  'TTS_BASE_URL',
  'TTS_API_KEY',
  'TTS_MODEL',
  'TTS_VOICE',
  'TTS_VOICE_PREFIX',
  'TTS_TIMEOUT_MS',
] as const

/**
 * 这一趟生成要用的那张表。两层：管理页写的那份覆盖 → `process.env` 兜底。
 *
 * 每次调用都现读一遍（不做模块级缓存）：读 20 个环境变量加一个几 KB 的 JSON
 * 是微秒级的事，而缓存住它会在"改完 .env.local 重启一下"与"没重启"之间
 * 造出一种只在生产上才出现的差别。
 * 而这一条现在是功能的一部分：管理页改完模型立刻生效，
 * 靠的就是"每次现读"。加了缓存，用户点完保存会以为没保存上。
 *
 * 顺序：文件压过环境变量。`.env.local` 是站长的"基线"，管理页改的是"眼下要用的"。
 * 某一项在文件里没有，就用环境变量那一份——所以"恢复默认"就是把它从文件里去掉，
 * 而不是往文件里写一个 `.env` 里的值（写进去之后，基线再改也不会跟上了）。
 */
export function serverEnv(): Env {
  const env: Env = {}
  for (const key of KEYS) {
    const raw = process.env[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed !== '') env[key] = trimmed
  }

  for (const [key, value] of Object.entries(readOverrides())) {
    // 只认清单上那些名字（与上面那条同一条纪律）：文件是管理员能写的东西，
    //   更要守住这张清单——不然往文件里塞一个 `LLM_DEBUG_DUMP` 就能进引擎
    if (!(KEYS as readonly string[]).includes(key)) continue
    const trimmed = value.trim()
    if (trimmed !== '') env[key] = trimmed
  }

  return env
}
