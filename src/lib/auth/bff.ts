/**
 * auth/bff.ts —— BFF 六个路由共用的那几行
 *
 * 抽出来的理由只有一条：失败回什么形状，只能有一处决定。
 * 六个路由各写一遍 `if (!res.ok)` 的话，早晚有一处会忘记带 `code`
 * （而界面的分支判断全靠它），或者把 401 写成 400。
 */

import { NextResponse } from 'next/server'

import type { Failure } from './response.ts'

/** 请求体读不出来（不是 JSON）时统一回这一句，与 Java 那边 `bad-json` 同一形状 */
export function badJson(): NextResponse {
  return NextResponse.json({ code: 'bad-json', message: '请求体不是合法的 JSON' }, { status: 400 })
}

/**
 * 后端的失败 → 给浏览器的失败。★ 状态码与那句话原样透传：
 * 界面上"验证码不对"（400）与"发得太频，请等 60 秒"（429）是两种不同的下一步，
 * 而把它们都压成一个 400 正是那种"什么都报同一句话"的坏接口。
 */
export function failureResponse(failure: Failure): NextResponse {
  return NextResponse.json(
    { code: failure.code, message: failure.message },
    // `status: 0` 是"网络层就没通"（`unreachable` 造的），而 `Response` 只接受
    //   200–599 —— 直接把 0 传进去会在构造响应时抛，于是"后端连不上"
    //   会变成一个 500 的栈，而不是那句"连不上账号服务"。归到 503（服务不可用）
    { status: failure.status >= 400 ? failure.status : 503 },
  )
}

/** 读一个 JSON 请求体。读不出来回 `null`，调用方直接 `badJson()` */
export async function jsonBody<T>(request: Request): Promise<T | null> {
  try {
    const raw: unknown = await request.json()
    if (!raw || typeof raw !== 'object') return null
    return raw as T
  } catch {
    return null
  }
}

/**
 * ── 那两行段配置为什么故意没有共享常量
 *
 * 这里原来导出过一个 `AUTH_ROUTE_CONFIG = { runtime: 'nodejs', dynamic: 'force-dynamic' }`，
 * 22 个路由写成 `export const runtime = AUTH_ROUTE_CONFIG.runtime`。那是个 bug：
 * Next 的静态分析读不了成员表达式，`pnpm build` 会以
 * `Invalid segment configuration export detected` 整包失败——而三道闸门
 * （eslint / tsc / 测试）全都看不见它，因为那是合法 TS。
 *
 * 所以每个路由文件自己写这两行字面量。值仍然是这两条，理由是：
 *   · `runtime = 'nodejs'` —— 验票用的是 `node:crypto`；
 *   · `dynamic = 'force-dynamic'` —— 这些响应依赖 cookie，被静态化/缓存住的话，
 *     一个人登录之后另一个人会拿到他的"我是谁"。
 *
 * 判据在 `src/lib/route-config.test.ts`（它扫 `src/app` 下所有 route / page / layout）。
 */
