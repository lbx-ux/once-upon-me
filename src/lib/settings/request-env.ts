/**
 * settings/request-env.ts —— 路由里那一份 `Env` 的唯一来源
 *
 * ADR-0008 的兑现处只有一条规矩：**key 只从请求体来**，服务端的 `process.env` 不参与。
 * 但这条规矩的写法被抄了五遍（`preview` 与 `cards*` / `optimize` / `probe` 各一份），
 * 五份里任何一份松一点（比如没剪空白、或漏了"空串不写"），症状都是**同一个**：
 * 某个能力在你没配的情况下"看起来配过了"，然后一路 404。
 *
 * 所以它归到这里，一个函数一个家。新增路由直接用它。
 * ★ 剩余的三处（`cards` / `cards/revise` / `optimize`）仍是各自那份旧写法——
 *   它们不是这一轮的活，但**没有**被忘掉：换成这个函数是纯替换，谁顺手谁做。
 */

import type { Env } from '@/lib/engine/providers/registry.ts'

/** 请求体里那一格 env 解成 `Env`。不是键值对 → null（调用方回 400） */
export function envFromBody(source: Record<string, unknown>): Env | null {
  const raw = source['env']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const env: Env = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    // ★ 空白一律不写（空串与缺位在 registry 里等价，但表里有个空串会让排障误以为配过），
    //   并且**剪掉前后空格**：复制粘贴带空格是最常见的一种"key 明明是对的却 401"。
    //   与 `settings/state.ts` 的 `toEnv` 同一条规矩——那一个是设置页那一侧的写入口。
    if (trimmed !== '') env[key] = trimmed
  }
  return env
}
