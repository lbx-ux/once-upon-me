/**
 * settings/model-list.ts —— 「从接口地址拉一份模型候选」（2026-10-17）
 *
 * 站长的原话：「这个模型，不是输入地址，就可以获取模型列表了吗」——
 * 对，只要那个地址是 OpenAI 兼容的：`GET {baseUrl}/models`。
 * **实测**（2026-10-17，tokenrhythm.studio/v1）：`200`，`data[].id` 一共 25 个，
 * 文字 / 图像 / 视觉三个能力配的是同一个地址，回的是同一份列表。
 *
 * ★ 拉回来的是**候选**，不是**选项表**。三条理由，头两条是实测出来的：
 *   1. **图像在用的 `wan2.7-image` 不在那 25 个里**——这个网关的 `/models`
 *      只列对话模型。做成强制选择的话，图像那一格会当场丢掉它正在用的值。
 *   2. 那份列表里**不区分能力**（`kimi-k2.6` 文字与视觉都能用），而"哪几个能干哪件事"
 *      是厂商侧的知识，这个接口里没有。
 *   3. 地址也可能不是这一家（自建网关、代理），返回形状未必是 `data[].id`。
 *   所以界面那边是 `<datalist>`（给候选、仍然能手填），不是 `<select>`。
 *
 * ★ 这一层**不碰 env、不认识"能力"**：地址与 key 由调用方按 `model-config.ts` 的
 *   `CAPABILITIES` 取好再传进来——"哪个能力用哪两个变量"因此仍然只有一处。
 *
 * ★ 失败**不是错误**：站长换了个还没配 key 的地址、或者那个地址没有 `/models`
 *   （语音那一路就未必有），都只意味着"这一格没有候选可给"，手填照旧能用。
 *   所以这里返回的是一句人话（`ok: false` + `message`），而不是抛异常。
 */

/** 接口地址 → `/models`。尾斜杠先去掉：`https://x/v1/` 直接拼会得到 `//models` */
export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/models`
}

/**
 * OpenAI 那种 `{ data: [{ id }] }`，也认 `{ models: [{ id | name }] }`。
 *
 * ★ 去重 + 排序：同一个 id 出现两次会让 `datalist` 里出现两个一样的候选，
 *   而"哪一个才是真的"在界面上没法回答。排序是为了让两次拉取**长得一样**
 *   （网关每次的顺序不保证），否则站长会以为列表变了。
 */
export function parseModelIds(payload: unknown): string[] {
  const record =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!record) return []

  const raw = Array.isArray(record['data'])
    ? record['data']
    : Array.isArray(record['models'])
      ? record['models']
      : []

  const ids = new Set<string>()
  for (const item of raw) {
    if (typeof item === 'string') {
      const id = item.trim()
      if (id !== '') ids.add(id)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = row['id'] ?? row['name']
    if (typeof id === 'string' && id.trim() !== '') ids.add(id.trim())
  }
  return [...ids].sort()
}

export type ModelListOk = { ok: true; endpoint: string; ids: string[] }
export type ModelListFail = { ok: false; endpoint: string; message: string }

/** 拉一次。`fetchImpl` 是参数：单元测试喂一个假的，不必真出网 */
export async function fetchModelIds(args: {
  baseUrl: string
  /** 没配 key 时是空串——照发，让那边自己回 401（比我们替它判断诚实） */
  apiKey?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<ModelListOk | ModelListFail> {
  const endpoint = modelsEndpoint(args.baseUrl)
  const doFetch = args.fetchImpl ?? fetch
  const timeoutMs = args.timeoutMs ?? 12_000

  let response: Response
  try {
    response = await doFetch(endpoint, {
      method: 'GET',
      headers: args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      ok: false,
      endpoint,
      message: `连不上这个地址（${err instanceof Error ? err.message : String(err)}）`,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      endpoint,
      message: `${statusWord(response.status)}（HTTP ${response.status}）`,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, endpoint, message: '那边回的不是 JSON' }
  }

  const ids = parseModelIds(payload)
  if (ids.length === 0) {
    return { ok: false, endpoint, message: '那边回了 JSON，但里面一个模型 id 都没有' }
  }
  return { ok: true, endpoint, ids }
}

/** 状态码翻成人话。只挑真会撞上的几个，其余照实说数字 */
function statusWord(status: number): string {
  if (status === 401 || status === 403) return '那边不认这把 key'
  if (status === 404) return '这个地址没有 /models 这个接口'
  if (status >= 500) return '那边自己出错了'
  return '那边没给列表'
}
