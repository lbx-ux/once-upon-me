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
    case 'provider-bad-response':
      // ★ 这句必须说清"哪一半没成"：读照片失败**不影响**照片那条路本身——
      //   照片照样能当参考图画形象，只是右边那八条要自己填。
      //   不说这一句的话，家长会以为"照片不能用了"，于是把一张好照片换掉。
      // ★ 2026-10-16：这句话原来写的是"再点一次通常就好了"——那是把重试推给家长。
      //   引擎现在自己会试第二次（`openai-vision.ts` 的 ATTEMPTS），所以这里改成
      //   如实说明"已经试过两次"，并把"换模型"这条真正的出路写上。
      return line(
        '模型这次没按格式把照片读出来',
        '已经替你试过两次了。这不影响照片本身——它照样能用来画形象，右边那八条你自己填；' +
          '也可以换一个视觉模型再试（推理型模型偶尔会"想完了没写"，换一个非推理的多模态模型更稳）。',
      )
    case 'schema-validation-failed':
      return line(
        '这个模型没能写出合格的故事表（换模型时最常见的坏法）',
        '再点一次通常会好；连着两三次都不行就换一个模型——结构化的故事表不是每个模型都能稳定输出。',
      )
    case 'review-blocked':
      // ★ 这一句的活儿是**把"格式不对"与"内容越线"分开**（`errors.ts` 那条注释写了理由）：
      //   家长看到"生成失败"时的第一反应是"再点一次"，而这里再点一次也不会好——
      //   要改的是**他想要的这个故事本身**，或者换一个模型。
      //   ★ 顺带说清一件真实的好消息：这道闸在**开始画之前**，所以没有为插图花钱。
      return line(
        '这一版里有不该给孩子看的内容，已经拦下了',
        '拦住它的是内容红线，上面那句写明了是哪一页、哪一条、哪个词。' +
          '换一个说法再试一次，或者换一个模型。这一步发生在开始画之前，所以没有为插图花钱。',
      )
    case 'profile-invalid':
      // 与 `card-invalid` / `reference-invalid` 三分的理由在 errors.ts 那三行注释里：
      // 档案是"他是谁"、卡是"他长什么样"、照片是"拿什么当参考"——
      // 三件事要去三个不同的地方改。合成一句"信息不完整"，家长不知道该动哪一格。
      return line(
        '这个孩子的档案不完整，存不下来',
        '回到第 1 步把名字、名字的读音、年龄档补齐——读音那一格不能空着，多音字读错孩子第一句就听得出来。',
      )
    case 'card-not-found':
      return line(
        '要找的那个形象不在了',
        '它可能已经被删掉，或者属于另一个孩子。回到「小主角」重新选一张。',
      )
    case 'page-not-found':
      return line(
        '这本书里没有这一页',
        '多半是这本书在别处重跑过、页数变了。刷新一下这一页，按现在摆出来的那几格重做。',
      )
    case 'card-invalid':
      return line('角色卡不合格，引擎拒绝开跑', '回到第 3 步改那几条被标出来的锚点。')
    case 'invalid-request':
      // ★ 这一句后面会接上引擎给的**具体缺什么**（`userMessageFor` 把原文附在末尾）。
      //   所以这里不重复细节，只做一件这句话才能做的事：告诉家长**这一次没有花钱**——
      //   `photoProblems` 在调模型之前就返回了，而他多半会怀疑"是不是已经扣了一笔"
      return line(
        '这次请求缺了必要的东西，所以没有开始处理',
        '按下面那句把缺的补上再试一次。这一次没有调用模型，也没有产生费用。',
      )
    case 'reference-invalid':
      // ★ 与 `card-invalid` 分开的那一条的理由在 normalize.ts 的 `@throws` 里：
      //   这里唯一要保证的是**这句话排在前面**，而具体哪里不对（太小/太细长/
      //   打不开）由引擎那句原文接在后面。所以这里不重复细节，只说该做什么。
      return line(
        '这张照片不能用作参考图',
        '换一张更清楚的：短边至少 240 像素、接近正方形。手机原图一般都可以，截图或头像小图通常不行。',
      )
    case 'asset-write-failed':
      // ★ 这一个码盖着**两件**事（2026-10-18 在管理页「测试连通」上撞到的）：
      //   `http.ts` 的 `fetchBytes` 把「把图**下回来**」那一步的失败（网络被掐、
      //   签名地址过期、HTTP 非 2xx）也报成这个码，而写下去那一步（磁盘满、
      //   目录不可写、路径越界）同样报它。
      //   原来那句话只说后一件——于是本机代理把 OSS 那一段掐断的那次，屏幕上写着
      //   「磁盘满了或目录不可写」，让人去清磁盘（而磁盘是空的）。改成两件都说得对。
      // ★ 这里**不用 `**` 加粗**：这句话是当纯文本画在屏幕上的（旁边那几句用了，
      //   于是屏幕上真的多出四个星号——那是既有的小毛病，不该再添一处）。
      return line(
        '这张图没进到这本书里（要么没下回来，要么没写下去）',
        '两种常见原因：下载那一步被掐断（网络 / 代理 / 签名地址过期），或者磁盘没空间、目录不可写。下面那句原文会说是哪一种。已经画好的图不会因为这一条被丢掉。',
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
 * 管理页那一侧的一次失败（2026-10-18，「测试连通」那一按）。
 *
 * ★ 与 `userFailureOf` 只差**一句**：`provider-not-configured`。
 *   那一句写的是「模型与密钥由你自己提供，我们没有替你兜底的那一份」——
 *   那是 ADR-0008 的口径（用户自己填 key 的那一版），而它 2026-10-16
 *   就被 [ADR-0009](docs/adr/0009-model-and-key-issued-by-operator.md) 推翻了：
 *   密钥只有站长一个来源。**在管理页看到这句话的人就是站长**，
 *   让他"回去把模型与 key 填上"等于让他在原地找自己。
 *   所以这一种改说"缺的是哪一格、去哪儿补"，而引擎那句话里本来就写着变量名。
 * ★ 其余分流一个字不动：那些是厂商侧的失败（key 不对、模型名不存在、限流），
 *   两个读者的下一步是同一件事——改配置或换模型。
 */
export function adminFailureOf(error: unknown): {
  code: string
  message: string
  retryable: boolean
  status: number
} {
  const base = userFailureOf(error)
  if (base.code !== 'provider-not-configured') return base
  return {
    ...base,
    message:
      `这一项还没配全：${asEngineError(error).message}\n` +
      '在管理页把缺的那一格填上并保存（改完立刻生效，不用重启），再点一次测试。',
  }
}

/**
 * 给界面判断"这条要不要显示成可重试"：配置类错误重试一百次也一样 */
export function isRetryable(error: unknown): boolean {
  const failure = asEngineError(error)
  if (
    failure.code === 'provider-not-configured' ||
    failure.code === 'card-invalid' ||
    failure.code === 'reference-invalid' ||
    failure.code === 'profile-invalid' ||
    failure.code === 'invalid-request' ||
    failure.code === 'card-not-found' ||
    failure.code === 'page-not-found'
  ) {
    return false
  }
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
  // `reference-invalid` / `profile-invalid` / `card-not-found` 是**本地**判出来的
  // （归一化、校验、查资产，根本没发出请求），所以它们没有 `httpStatus` 可读——
  // 但它们百分之百是"调用方输入的问题"，回 502 会把它说成平台故障。
  //
  // ★ `card-invalid` 也补进来了（2026-10-15，工单 03）。它原来**漏在这张表外面**，
  //   于是"锚点不合格"回的是 502：一句"平台那边超时或不可用"盖在一句
  //   "回到第 3 步改锚点"上面（工单 02 §五 6 记着这条，当时故意没顺手改）。
  //   现在三个"输入不合格"的码走同一条出口，是因为工单 03 又添了第四个——
  //   留着它只会让下一个人以为那几个码之间真有区别。
  const ours =
    failure.code === 'reference-invalid' ||
    failure.code === 'profile-invalid' ||
    failure.code === 'card-invalid' ||
    failure.code === 'invalid-request' ||
    failure.code === 'card-not-found' ||
    failure.code === 'page-not-found' ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422
  const upstream = status === 429 || (status !== undefined && status >= 500)
  return {
    code: failure.code,
    message: userMessageFor(failure),
    retryable: isRetryable(failure),
    // 资产没了（卡、页）是 404，其余输入问题都是 400
    status:
      failure.code === 'card-not-found' || failure.code === 'page-not-found'
        ? 404
        : ours
          ? 400
          : upstream
            ? 503
            : 502,
  }
}
