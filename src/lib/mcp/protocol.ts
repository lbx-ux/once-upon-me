/**
 * protocol.ts —— MCP 的 JSON-RPC 2.0 那一层（★ 纯函数，进程与传输都不在这里）
 *
 * 这是 `events.ts` 那句「同一串事件喂三个消费者：前端可视化、MCP 工具返回、
 * 技术文档里的过程日志」里第三个消费者的落点。它做三件事：
 *
 * 1. 把一行 JSON 读成一次请求/通知，把结果写成待发出的行；
 * 2. 认六个方法（`initialize` / `notifications/initialized` / `ping` /
 *    `tools/list` / `tools/call` / `logging/setLevel`）；
 * 3. 把 `EngineEvent` 翻成 MCP 的两种通知（进度 + 日志）。
 *
 * 它不碰 `process`：`stdin` / `stdout` / `stderr` 全在 `mcp/server.mts`。
 *   理由不是洁癖，是闸门：`mcp/server.mts` 是 `.mts`，
 *   而 `.mts` 不进 `pnpm typecheck`——`tsconfig.json` 的 include 只写到 `.ts`，
 *   实测 `.mts` 不在其中（`scripts/` 一直如此）。
 *   逻辑留在这个文件里，才既过 typecheck 又跑 vitest。
 *
 * ★ 手写而不是引 `@modelcontextprotocol/sdk`：理由与代价见 ADR-0012，
 *   翻案条件是工单 05 的判据 1（真客户端连不上就引）。
 *
 * 四条按 MCP 规范钉住的约定，每一条都对应一种真实的坏法：
 *
 * 1. 不带 `id` 的通知绝不回话。回了的话客户端会把那条响应错配到别处，
 *    从那一刻起整条会话开始错位——而错误现场离成因很远。
 * 2. `id` 原样回（数字与字符串都原样）。`String(id)` 一下，数字 id 就变成了字符串 id，
 *    客户端按 `===` 找响应会找不到，表现为"客户端卡住等一个永远不来的回复"。
 * 3. 非法 JSON 回 `-32700` 之后继续读下一行，不退出。
 *    一行坏数据不该让整条会话死掉——它是流式读取，坏的那一行后面还有正常的。
 * 4. **没 `initialize` 就 `tools/call` 要报错**（`-32600`）。
 *    用的是 `-32600 Invalid Request` 而不是 `-32002`：后者在规范里是
 *    "Resource not found"，借来当"没初始化"会在排障时把人带偏。
 *    这一条也是"协议实现自己守纪律"的一部分——顺着它做完就能发现
 *    自己的客户端忘了握手。
 */

import { describeEvent, isDisplayable, type EngineEvent } from '../engine/events.ts'

/* 版本与等级 */

/**
 * 认得的协议版本，新的在前。
 *
 * 协商规则（MCP 规范）：客户端在 `initialize` 里报一个版本，
 *   我们支持就回它那一个，不支持就回我们最新的那一个，由客户端决定要不要继续。
 *   回"我们最新的"而不是"报错"，是因为报错会让一个只差一个版本的客户端
 *   连不上——而那一版的差异通常与我们这六个方法无关。
 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number]
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = '2025-06-18'

/** RFC 5424 的八档（MCP 的日志通知就用这套名字） */
export const LOG_LEVELS = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
}

/** `level` 够不够 `threshold`。索引越大越严重，所以是"至少"而不是"相等" */
export function levelAtLeast(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold)
}

/* 工具那一侧的接口 */

export type ToolSpec = {
  name: string
  description: string
  /** JSON Schema。★ 它必须与 handler 里的校验同源，否则那张表是装饰（工单 03） */
  inputSchema: Record<string, unknown>
}

export type ToolResult = {
  /** 回给模型的那段文本。这一轮只有 text，不回图片（见 spec §七） */
  text: string
  /** 这一条工具没做成。★ 与 JSON-RPC 的 error 是两件事：那是"协议层坏了"，这是"这次没成" */
  isError?: boolean
}

export type ToolCallInput = {
  name: string
  args: unknown
  /**
   * 工具一边跑一边把引擎事件交上来。协议层立刻把它翻成通知写出去
   * （不是攒到最后一起发）——一本 20 页的书要跑几分钟，
   * 攒到最后的话进度通知就退化成"跑完了一次性刷 100 行"。
   */
  notify: (event: EngineEvent) => void
}

export type ToolRuntime = {
  specs(): readonly ToolSpec[]
  call(input: ToolCallInput): Promise<ToolResult>
}

/* 会话状态 */

export type Session = {
  /** 有没有收到过 `initialize`（收到并回了就算，不等 `notifications/initialized`——
   *  实测多数客户端在 `initialize` 的响应到达之前就……不会发别的请求，所以两者等价；
   *  而等它的话，一个忘了发那条通知的客户端会永远被拒
   */
  initialized: boolean
  /** 协商出来的版本 */
  protocolVersion: ProtocolVersion
  /** `logging/setLevel` 设的阈值。缺省 `info` */
  logLevel: LogLevel
}

export const INITIAL_SESSION: Session = {
  initialized: false,
  protocolVersion: LATEST_PROTOCOL_VERSION,
  logLevel: 'info',
}

/* 消息形状 */

type JsonRpcId = string | number

type Incoming = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

type Outgoing = Record<string, unknown>

const JSONRPC = '2.0'

/** 序号 → 响应。`id` 原样带出（见文件头第 2 条） */
function result(id: JsonRpcId, value: unknown): Outgoing {
  return { jsonrpc: JSONRPC, id, result: value }
}

function errorOf(id: JsonRpcId | null, code: number, message: string, data?: unknown): Outgoing {
  return {
    jsonrpc: JSONRPC,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/* 事件 → 通知 */

export type NotificationContext = {
  /** 请求 `_meta.progressToken` 给的值。没给就一条进度通知都不发 */
  progressToken?: JsonRpcId
  level: LogLevel
}

/**
 * 一条引擎事件 → 该发出去的通知（可能 0 条、1 条或 2 条）。
 *
 * 这是「MCP 返回与日志也要同一句话」那句注释的兑现处：
 *   两句人话都来自 `describeEvent`，不在这里另写一份。
 *   `events.ts` 的顶部写着「放在引擎侧而不是 UI 侧」的理由，
 *   而这里正是它点名的第二个消费者——在这拼一句自己的话，那句注释当天就变成假的。
 *
 * 进度与日志是两件事，所以可以是两条通知：
 *   · `notifications/progress` 是给进度条的，每条事件都发（`progress` 用 `seq`），
 *     客户端要不要显示是它的事；
 *   · `notifications/message` 是给人读的日志，只发 `isDisplayable` 的那些
 *     （通过的一致性核对不占行——`isDisplayable` 的理由写在它自己的注释里，
 *     这里不重新判一遍，判两遍就会漂）。
 */
export function notificationsFor(event: EngineEvent, ctx: NotificationContext): Outgoing[] {
  const out: Outgoing[] = []
  const message = describeEvent(event)
  if (ctx.progressToken !== undefined) {
    out.push({
      jsonrpc: JSONRPC,
      method: 'notifications/progress',
      params: {
        progressToken: ctx.progressToken,
        // 用 `seq` 而不是自增的一个计数：`seq` 是"每本书从 1 起、重做接着数"的那个数
        //   （见 `createEventFactory`），重连之后两台机器数的是同一件事。
        progress: event.seq,
        message,
      },
    })
  }
  if (isDisplayable(event) && levelAtLeast('info', ctx.level)) {
    out.push({
      jsonrpc: JSONRPC,
      method: 'notifications/message',
      params: { level: 'info', logger: 'xiaozhujue', data: { event, message } },
    })
  }
  return out
}

/* 派发 */

export type DispatchOutcome = {
  session: Session
  /** 只该写 stderr 的东西（协议之外）。不许混进写给客户端的行里 */
  notes: string[]
}

export type Emit = (line: string) => void

/**
 * 处理一行输入。
 *
 * `emit` 是注入的，不在这个文件里写 stdout：测试传一个数组收集器就能断言
 *   "这一行该回几条、顺序对不对"，而起子进程去测的话，
 *   "写出去没有"与"客户端收到没有"两件事会混在一起。
 *
 * 通知边跑边发（`emit` 在 `tools/call` 的 await 里面被调），
 *   不是攒到最后——理由见 `ToolCallInput.notify`。
 */
export async function dispatch(
  line: string,
  session: Session,
  runtime: ToolRuntime,
  emit: Emit,
): Promise<DispatchOutcome> {
  const notes: string[] = []
  const trimmed = line.trim()
  if (trimmed === '') return { session, notes }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    // 解析失败时不知道 id，所以只能回 `null`（JSON-RPC 2.0 §5 就是这么定的）
    emit(JSON.stringify(errorOf(null, ERROR_CODES.parse, `这行不是合法 JSON：${reasonOf(err)}`)))
    return { session, notes }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    emit(JSON.stringify(errorOf(null, ERROR_CODES.invalidRequest, '一条消息要是一个 JSON 对象')))
    return { session, notes }
  }

  const message = parsed as Incoming
  const id = isId(message['id']) ? (message['id'] as JsonRpcId) : null
  const method = typeof message['method'] === 'string' ? message['method'] : ''

  if (method === '') {
    // 没有 method：既不是合法的请求也不是合法的通知
    if (id !== null) {
      emit(JSON.stringify(errorOf(id, ERROR_CODES.invalidRequest, '这条消息没有 method')))
    } else {
      notes.push(`收到一条既没有 id 也没有 method 的消息，忽略：${trimmed.slice(0, 120)}`)
    }
    return { session, notes }
  }

  /* 握手之前只放行 initialize 与 ping */
  if (!session.initialized && method !== 'initialize' && method !== 'ping') {
    if (id === null) {
      // 通知不回话，哪怕它来得不是时候（文件头第 1 条）。
      //   规范的处置也是"忽略它"，而不是回一条错误。
      notes.push(`initialize 之前收到通知 ${method}，忽略`)
    } else {
      emit(
        JSON.stringify(
          errorOf(
            id,
            ERROR_CODES.invalidRequest,
            `服务还没有 initialize：先发 initialize，再发 ${method}`,
          ),
        ),
      )
    }
    return { session, notes }
  }

  switch (method) {
    case 'initialize': {
      const params = objectOf(message['params'])
      const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : ''
      const agreed = (PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? (asked as ProtocolVersion)
        : LATEST_PROTOCOL_VERSION
      const clientInfo = objectOf(params['clientInfo'])
      notes.push(
        `客户端 ${String(clientInfo['name'] ?? '?')} ${String(clientInfo['version'] ?? '')} ` +
          `要 ${asked || '（没报版本）'}，用 ${agreed}`,
      )
      if (id !== null) {
        emit(
          JSON.stringify(
            result(id, {
              protocolVersion: agreed,
              capabilities: {
                // 声明什么就得实现什么：`tools` 与 `logging` 两个都真有实现
                //   （`tools/list` + `tools/call`；`logging/setLevel` 真的改阈值）。
                //   `resources` / `prompts` / `sampling` 不声明——声明了而不实现，
                //   是这一层最容易留下的一种谎。
                tools: {},
                logging: {},
              },
              serverInfo: { name: 'xiaozhujue', version: '1.0.0' },
              instructions:
                '小主角（Once Upon Me）的绘本引擎。先 list_children 看这个账号下有哪些孩子，' +
                '再 character_card 看他长什么样；plan_book 编一版故事，illustrate_book 出图' +
                '（异步，用 book_status 收进度）。',
            }),
          ),
        )
      }
      return {
        session: { ...session, initialized: true, protocolVersion: agreed },
        notes,
      }
    }

    case 'notifications/initialized': {
      // 握手完成的通知。已经 initialized 了（见 `Session.initialized` 的注释），
      // 这里只是记一笔，不回话。
      notes.push('客户端报告 initialize 完成')
      return { session, notes }
    }

    case 'ping': {
      if (id !== null) emit(JSON.stringify(result(id, {})))
      return { session, notes }
    }

    case 'tools/list': {
      if (id !== null) {
        emit(JSON.stringify(result(id, { tools: runtime.specs().map(shapeOfSpec) })))
      }
      return { session, notes }
    }

    case 'logging/setLevel': {
      const params = objectOf(message['params'])
      const level = params['level']
      if (!isLogLevel(level)) {
        if (id !== null) {
          emit(
            JSON.stringify(
              errorOf(
                id,
                ERROR_CODES.invalidParams,
                `level 只接受 ${LOG_LEVELS.join(' / ')}，收到「${String(level)}」`,
              ),
            ),
          )
        }
        return { session, notes }
      }
      if (id !== null) emit(JSON.stringify(result(id, {})))
      notes.push(`日志等级设为 ${level}`)
      return { session: { ...session, logLevel: level }, notes }
    }

    case 'tools/call': {
      const params = objectOf(message['params'])
      const name = typeof params['name'] === 'string' ? params['name'] : ''
      if (name === '') {
        if (id !== null) {
          emit(JSON.stringify(errorOf(id, ERROR_CODES.invalidParams, 'tools/call 缺 name')))
        }
        return { session, notes }
      }

      const meta = objectOf(params['_meta'])
      const token = meta['progressToken']
      const progressToken = isId(token) ? (token as JsonRpcId) : undefined
      const ctx: NotificationContext = {
        ...(progressToken === undefined ? {} : { progressToken }),
        level: session.logLevel,
      }

      const notify = (event: EngineEvent): void => {
        for (const notification of notificationsFor(event, ctx)) emit(JSON.stringify(notification))
      }

      try {
        const outcome = await runtime.call({
          name,
          args: params['arguments'],
          notify,
        })
        if (id !== null) {
          emit(
            JSON.stringify(
              result(id, {
                content: [{ type: 'text', text: outcome.text }],
                ...(outcome.isError ? { isError: true } : {}),
              }),
            ),
          )
        }
      } catch (err) {
        // 工具抛了才是协议层的错（`ToolResult.isError` 是"这次没成"）。
        //   两者分开报，是因为它们的下一步不同：这一个要去读服务器的日志，
        //   那一个多半是模型把参数写错了、再试一次就行。
        const detail = err instanceof Error ? err.message : String(err)
        notes.push(`工具 ${name} 抛出：${detail}`)
        if (id !== null) {
          emit(
            JSON.stringify(errorOf(id, ERROR_CODES.internal, `工具 ${name} 内部错误：${detail}`)),
          )
        }
      }
      return { session, notes }
    }

    default: {
      if (id !== null) {
        emit(
          JSON.stringify(
            errorOf(id, ERROR_CODES.methodNotFound, `这个服务没有 ${method} 这个方法`),
          ),
        )
      } else {
        notes.push(`收到不认识的通知 ${method}，忽略`)
      }
      return { session, notes }
    }
  }
}

/* 小工具 */

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 工具的对外那一份。★ 只出 `name` / `description` / `inputSchema` 三件——
 *  handler 与 ctx 是内部的事，混进去会在客户端那一侧变成一段没有读者的 JSON
 */
function shapeOfSpec(spec: ToolSpec): Record<string, unknown> {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
  }
}
