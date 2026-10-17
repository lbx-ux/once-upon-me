/**
 * settings/server-env.ts —— ★ **密钥的唯一来源**（工单 05）
 *
 * 上一轮这一份是从请求体里来的（已删除的 `request-env.ts` 的 `envFromBody`）：用户在
 * 「模型与密钥」抽屉里填 key，每个请求把它带上来（ADR-0008）。
 * 这一轮反过来（ADR-0009）：**密钥由站长分配，只从服务端环境来**。
 *
 * ★ 这一层与 `toEnv()`（原来在已删除的 `settings/state.ts`）是同一件事的两个时代：
 * 那时它是"用户填的表 → env 表"，现在是"`process.env` → env 表"。
 * 规矩一条没变，**而且必须一条不变**，因为下游（`engine/providers/registry.ts`）
 * 认的就是那张表的形状：
 *
 *   · 值**剪掉前后空白**：复制粘贴带一个尾空格，是最常见的一种"key 明明对却 401"；
 *   · 空串**不写进表**：registry 对空串与缺位的处理一样，但"表里有个空串"
 *     会让排障时误以为配过了（这条是原来那段注释里的原话，它救过一次排障）；
 *   · 视觉（`VISION_*`）**不回落到 `LLM_*`**，图像也不回落——接口形状不同，
 *     回落只会把"配置错了"变成一个运行期 400。
 *
 * ★ 环境变量名一个都没改：`.env.local` 里那几行今天就是生产配置，
 * 所以"把密钥搬到服务端"这件事**没有一次配置迁移**。改的只是它从哪儿读。
 */

import type { Env } from '@/lib/engine/providers/registry.ts'

/**
 * 从 `process.env` 取的那几项。**写全**，不写成 `startsWith('LLM_')` 那种：
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
  'IMAGE_SUPPORTS_REFERENCE',
  // 视觉（核对形象）
  'VISION_BASE_URL',
  'VISION_API_KEY',
  'VISION_MODEL',
  'VISION_TIMEOUT_MS',
  'VISION_MAX_TOKENS',
  // 语音（朗读）
  'TTS_BASE_URL',
  'TTS_API_KEY',
  'TTS_MODEL',
  'TTS_VOICE',
  'TTS_TIMEOUT_MS',
] as const

/**
 * 这一趟生成要用的那张表。
 *
 * ★ 每次调用都现读一遍（不做模块级缓存）：读 20 个环境变量是纳秒级的事，
 * 而缓存住它会在"改完 .env.local 重启一下"与"没重启"之间造出一种
 * 只在生产上才出现的差别。
 */
export function serverEnv(): Env {
  const env: Env = {}
  for (const key of KEYS) {
    const raw = process.env[key]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed !== '') env[key] = trimmed
  }
  return env
}
