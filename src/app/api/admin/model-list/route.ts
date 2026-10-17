/**
 * `GET /api/admin/model-list?capability=text` —— 拉那个能力的接口地址下的模型候选
 *
 * ```
 *   200 { ok: true,  endpoint: "https://…/v1/models", ids: ["glm-5.3", …] }
 *   200 { ok: false, endpoint: "https://…/v1/models", message: "那边不认这把 key（HTTP 401）" }
 *   400 { code: "bad-capability", … }   不认识的 capability
 *   403 { code: "not-admin",     … }    requireAdmin 那一关（与别的 admin 接口同一条）
 * ```
 *
 * ★ **拉不到不是 HTTP 错误**（所以失败也是 200）：站长换了个还没配 key 的地址、
 *   或者那个地址没有 `/models`（语音那一路很可能就是这样），都只意味着
 *   "这一格没有候选可给"——而那一格本来就还能手填。回 4xx 会让界面把
 *   一句"没有候选"画成红字，那是假的严重。
 *
 * ★ 这是**唯一**一处拿 key 出去做"非生成"请求的地方。三条守则：
 *   1. key 只进 `Authorization` 头，**不进**响应（连日志都不带：这里一个字都不打）；
 *   2. 地址由**服务端**按能力取（下面 `accessOf`），客户端传的只有一个能力名——
 *      否则这就是一个"随便谁都能让服务端带着 key 去打任意地址"的洞；
 *   3. 超时 12 s（`model-list.ts` 的默认）。
 *
 * ★ 路径**不挂在 `/model-config/` 下面**：那底下已经有一个动态段
 *   `[capability]`，再放一个静态的 `models` 会让 `/model-config/models`
 *   同时匹配两条路由（静态优先，但两条路阴影里那一条永远没人走到，
 *   下一个人会以为它坏了）。平铺在 `/api/admin/` 下没有这个问题。
 */

import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/auth/session.ts'
import { capabilitySpec } from '@/lib/settings/model-config.ts'
import { fetchModelIds } from '@/lib/settings/model-list.ts'
import { serverEnv } from '@/lib/settings/server-env.ts'

// ★ 段配置必须是**字面量**：成员表达式 Next 读不了，而它只在 `pnpm build` 那一刻才报（判据见 lib/route-config.test.ts）
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.response

  const id = request.nextUrl.searchParams.get('capability') ?? ''
  const spec = capabilitySpec(id)
  if (!spec) {
    return NextResponse.json(
      { code: 'bad-capability', message: `不认识的 capability：${id || '（空）'}` },
      { status: 400 },
    )
  }

  const access = accessOf(spec.id)
  if (!access.baseUrl) {
    return NextResponse.json({
      ok: false,
      endpoint: '',
      message: '这一项还没配接口地址——填上并保存之后再来拉',
    })
  }

  const result = await fetchModelIds({ baseUrl: access.baseUrl, apiKey: access.apiKey })
  return NextResponse.json(result)
}

/**
 * 这个能力此刻**实际会用到**的地址与 key。
 *
 * ★ 变量名取自 `CAPABILITIES`（`model-config.ts`）——**不在这里再抄一遍**
 *   `LLM_BASE_URL` 这种字符串，那样加一个能力就会漏一处。
 * ★ 唯一的例外是**视觉的 key 回落**（`VISION_API_KEY` 空时引擎用 `LLM_API_KEY`，
 *   见 `engine/providers/registry.ts` 规则 3）：那是一条**值的规则**，
 *   不在变量名表里，所以这两行是照抄引擎的。抄错的代价很小（那一格少一份候选、
 *   或者说一句"那边不认这把 key"），但**不能装作没有**——所以写在这里。
 */
function accessOf(capability: string): { baseUrl: string; apiKey: string } {
  const spec = capabilitySpec(capability)
  const env = serverEnv()
  const named = (fieldId: 'baseUrl' | 'apiKey'): string => {
    const field = spec?.fields.find((item) => item.id === fieldId)
    return field ? (env[field.env] ?? '') : ''
  }

  const baseUrl = named('baseUrl')
  const apiKey = named('apiKey') || (capability === 'vision' ? (env['LLM_API_KEY'] ?? '') : '')
  return { baseUrl, apiKey }
}
