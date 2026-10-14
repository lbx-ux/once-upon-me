/**
 * provider-messages.ts —— 把引擎的异常翻成**用户能照做的话**（ADR-0008 的第二个读者）
 *
 * ADR-0008 之后错误有了两个读者：开发者（
 * `.env.local` 里的 key、node 脚本）与**终端用户**（表单里自己填的模型与 key）。
 * 引擎里的那句话是对开发者说的，而且说得对——"真实密钥只写 .env.local，
 * 仓库公开，提交上去撤不回来"。但让一个刚填完表单的家长去改 `.env.local` 是荒谬的。
 *
 * 所以翻译放在**这里**（app 层），不放引擎里：引擎不认识"表单"这个说法，
 * 它只该说"哪个变量、哪次调用、供应商回了什么"。
 *
 * ★ 三条实现纪律：
 *
 * 1. **按 `code` + `httpStatus` 分流，不匹配 message**。message 是给人读的文案，
 *    改一个字就会把界面改坏，而且这种坏法没有测试会红。所以 `EngineError` 补了
 *    `httpStatus` / `providerCode` 两个结构化字段（见 engine/errors.ts）。
 * 2. **每一句都要能回答"我现在该做什么"**。BYO 之后"任意模型会以各种方式坏"
 *    是产品前提（ADR-0008 原话），所以这些不是兜底页，是常态页。
 * 3. **开发者那句话照旧带上**（附在最后）。用户版是**追加**一个解释，
 *    不是把原文换掉——换掉之后我们自己排障时反而看不到供应商原文。
 */

import { asEngineError, type EngineError } from './engine/index.ts'

/** 一句话的构成：先说"发生了什么"，再说"你该做什么" */
function line(what: string, todo: string): string {
  return `${what}。${todo}`
}

const KEY_HINT =
  '检查一下是不是复制全了、有没有多带空格；如果这家平台要实名或先开额度，也要先在平台上开通。'

/**
 * 供应商侧的失败按状态码分流。
 *
 * ★ 403 那条来自 W1 的实测：它是**灰度权限**问题——"改参数无用，要去找平台申请"。
 *   把 403 与 401 并成一句"key 不对"，会让人反复改 key 而永远改不好。
 */
function byStatus(status: number | undefined, providerCode: string | undefined): string | null {
  switch (status) {
    case 401:
      return line('这台服务器不认你填的 API key', KEY_HINT)
    case 403:
      return line(
        '你的账号还没有这个模型的权限（这是平台侧的灰度权限，改参数没用）',
        '去平台上申请这个模型，或者换一个你已经开通的模型名。',
      )
    case 404:
      return line(
        '这个模型名在这家平台上不存在（或者你的账号看不到它）',
        '对照平台文档抄一遍模型名；拿不准就先用我们验过的默认推荐值。',
      )
    case 413:
      return line('请求体超了平台的上限', '多半是参考图太大或提示词太长；换小一点的参考图再试。')
    case 422:
      return line(
        '平台不接受这次请求的参数',
        '这一条通常与模型有关（比如有些模型不接受某个字段）。换一个模型试，并把上面那句原文发给我们。',
      )
    case 429:
      return line('平台限流了', '等一两分钟再试，或者换一个模型。这不是你填错了什么。')
    case 502:
    case 503:
    case 504:
      return line('平台那边超时或不可用', '等一会儿再试，或者换一个模型。你们的 key 没有问题。')
    default:
      break
  }
  if (providerCode === 'REASONING_REQUIRED') {
    // W1 实测：glm-5.3-flash 不允许关思考，送 false 回 400 · REASONING_REQUIRED
    return line(
      '这个模型必须开着思考链，而我们的默认档是关思考',
      '换一个模型，或者按 docs/tech-selection.md §9.1.1 的那条实测把预算提到 16000 并打开思考。',
    )
  }
  return null
}

/**
 * 引擎侧的失败按 code 分流。这些多是"配置"或"这个模型不行"，与网络无关。
 */
function byCode(error: EngineError): string | null {
  switch (error.code) {
    case 'provider-not-configured':
      return line(
        '模型与密钥没配全，这一轮跑不起来',
        '回到上一步把文本模型、图像模型与各自的 key 填上（模型与密钥由你自己提供，我们没有替你兜底的那一份）。',
      )
    case 'schema-validation-failed':
      return line(
        '这个模型没能写出合格的故事表（换模型时最常见的坏法）',
        '再点一次通常会好；连着两三次都不行就换一个模型——结构化的故事表不是每个模型都能稳定输出。',
      )
    case 'card-invalid':
      return line('角色卡不合格，引擎拒绝开跑', '回到第 3 步改那几条被标出来的锚点。')
    case 'asset-write-failed':
      return line(
        '资产没法落盘（磁盘满了或目录不可写）',
        '清一点磁盘空间再试。已经画好的图不会因为这一条被丢掉。',
      )
    case 'aborted':
      return line(
        '这次调用超时了，我们没有自动重试',
        '生成类的调用超时**不能盲目重试**（服务端可能已经建单，重试就是重复扣费）。等一会儿再点一次。',
      )
    default:
      return null
  }
}

/**
 * 给终端用户的一句话。
 *
 * 兜底分支**保留供应商原文**：宁可给一句长话，也不要说"未知错误"——
 * 未知错误是排障的终点，而排障的起点是原文。
 */
export function userMessageFor(error: unknown): string {
  const failure = asEngineError(error)
  const specific = byStatus(failure.httpStatus, failure.providerCode) ?? byCode(failure) ?? null
  if (!specific) return failure.message
  return `${specific}\n（供我们排障的原文：${failure.message}）`
}

/**
 * 给界面判断"这条要不要显示成可重试"：配置类错误重试一百次也一样 */
export function isRetryable(error: unknown): boolean {
  const failure = asEngineError(error)
  if (failure.code === 'provider-not-configured' || failure.code === 'card-invalid') return false
  const status = failure.httpStatus
  if (status === 401 || status === 403 || status === 404) return false
  return true
}

/**
 * 一次失败的**对外契约**：文案 + 可重试性 + HTTP 状态码，一次算清。
 *
 * ★ 为什么要有它，而不是让每个 Route Handler 自己拼：
 *   实测踩过一次——401（key 不对）经引擎规约后 code 是 `provider-call-failed`，
 *   客户端只看 code 就会判成"可重试"，于是在一句"这台服务器不认你填的 API key"
 *   下面贴一个"（可以再点一次）"。**文案与可重试性必须同源**，
 *   否则它们会在某一条错误上互相打脸。
 *
 * 状态码也按"错在谁"分：凭据/模型名不对是**调用方输入**的问题（400），
 * 平台限流或故障才是网关那一侧的问题（503/502）。
 */
export function userFailureOf(error: unknown): {
  code: string
  message: string
  retryable: boolean
  status: number
} {
  const failure = asEngineError(error)
  const status = failure.httpStatus
  const ours = status === 401 || status === 403 || status === 404 || status === 422
  const upstream = status === 429 || (status !== undefined && status >= 500)
  return {
    code: failure.code,
    message: userMessageFor(failure),
    retryable: isRetryable(failure),
    status: ours ? 400 : upstream ? 503 : 502,
  }
}
