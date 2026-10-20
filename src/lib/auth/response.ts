/**
 * auth/response.ts —— "一次请求的响应怎么读"这件事，只有这一处
 *
 * 为什么它单独存在：这一层有两个调用方，而它们跑在两个世界里——
 * `backend.ts` 在服务端（打 Java，绝对地址 + 内部令牌），
 * `client.ts` 在浏览器（打 BFF，相对地址 + cookie）。
 * 但"失败了要说什么话"必须一模一样：都是 `{code, message}` 那一份。
 * 两份各写一遍的那天起，界面就会开始对同一件事有两种说法。
 *
 * 有一条判据贯穿这个文件：失败不抛，返回一个 discriminated union。
 * `await fetch()` 抛出来的异常与"后端回了 403"长得一模一样，
 * 而它们该说的话完全不同。
 */

/** 失败。`code` 给程序分支，`message` 是能直接显示给人看的一句中文 */
export type Failure = { ok: false; status: number; code: string; message: string }

export type Result<T> = { ok: true; data: T } | Failure

/** 网络层就没通（连不上、超时）。★ `status: 0` 是"没有状态码"的意思 */
export function unreachable(detail: string): Failure {
  return {
    ok: false,
    status: 0,
    code: 'unreachable',
    message: `连不上服务（${detail}）。如果刚部署过，看一眼服务起来没有`,
  }
}

/** 一次响应的正文 → `Result`。★ 后端给的那句话原样用，不做二次创作 */
export async function readResult<T>(response: Response): Promise<Result<T>> {
  const noBody = response.status === 204 || response.headers.get('content-length') === '0'

  let payload: unknown = null
  if (!noBody) {
    try {
      payload = await response.json()
    } catch {
      /* 空体或不是 JSON：下面按状态码处理 */
    }
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { code?: unknown; message?: unknown }
    return {
      ok: false,
      status: response.status,
      code: typeof body.code === 'string' ? body.code : `http-${response.status}`,
      message:
        typeof body.message === 'string'
          ? body.message
          : `服务拒绝了这次请求（${response.status}）`,
    }
  }

  return { ok: true, data: payload as T }
}
