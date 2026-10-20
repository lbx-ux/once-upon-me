/**
 * sse.ts —— Server-Sent Events 的帧编解码（纯函数，node 与浏览器共用）
 *
 * 它住在 `engine/` 里，不在 `lib/` 根下（2026-10-15 搬的）。理由不是整洁：
 *   供应商那一侧的流式解析（`providers/http.ts` 的 `requestSse`）也要用它，
 *   而"引擎 import 界面层的模块"是把依赖方向反过来（README §二：界面 import 引擎，
 *   不是反过来）。搬进来之后，SSE 的分帧逻辑只有这一份——
 *   在此之前它被写了两遍：一遍给浏览器读 `/api/books`，一遍给适配器读供应商的流，
 *   而"跨 chunk 的半行要留住"这件事一旦只在一处修对，另一处就会安静地吞掉半条帧。
 *
 * 为什么自己写这 90 行而不是引一个库：SSE 的线上格式只有三种行
 * （`event:` / `data:` / `id:`，空行分隔），而解码的难点只有一个——
 * 网络分块会从任意位置切开一帧。真正要下车的是那个增量缓冲，
 * 不是"找第一个换行"这件事本身的复杂度。核对一个库在这件事上的行为
 * （它允许多少种换行、多行 data 怎么拼、空帧丢不丢）比自己写一遍贵。
 *
 * 三条实现约定，都来自 SSE 规范，写在这里免得下次重推：
 *
 * 1. 空行分帧，且只有出现过 `data:` 的帧才算数。只带 `event:` 不带 `data:` 的块
 *    必须丢掉（规范原话），否则心跳注释那种块会被当成一条空事件喂给界面。
 * 2. **多行 `data:` 用 `\n` 拼回**。所以载荷里的换行是安全的——
 *    这条对我们是必需的：pipeline 里的 `reason` 字段就带换行（重试提示是多行的）。
 * 3. `:` 开头是注释，整行忽略。反向代理的保活心跳就是这么发的，
 *    把它当数据喂下去会在界面上冒出一条空事件。
 *
 * 解码器是有状态的（跨 chunk 的半个字节要留着），所以它是一个工厂而不是纯函数；
 *   它内部除了那个缓冲没有别的状态，push 出来的帧顺序与到达顺序一致。
 *   缓冲里的最后半行由 `flush()` 交出来——见那个方法的注释。
 */

/** 一帧的字段。`id` 本仓库暂时不用（不做 Last-Event-ID 续传，见工单 02 §2.4），留着是因为编码要向规范靠 */
export type SseFrame = {
  event: string
  data: string
  id?: string
}

/** 编一帧。返回值以空行结尾，这是分帧的依据 */
export function encodeFrame(frame: SseFrame): string {
  const lines: string[] = []
  if (frame.id !== undefined) lines.push(`id: ${frame.id}`)
  lines.push(`event: ${frame.event}`)
  // 载荷里的每一个换行都要变成一条 data: 行，接收端再拼回来
  for (const line of frame.data.split('\n')) lines.push(`data: ${line}`)
  return `${lines.join('\n')}\n\n`
}

/** 只解析帧文本（测试与脚本用）。真实消费方用 createSseDecoder——分块边界不归调用方管 */
export function decodeFrames(text: string): SseFrame[] {
  const decoder = createSseDecoder()
  return decoder.push(text)
}

export function createSseDecoder(): { push(chunk: string): SseFrame[]; flush(): SseFrame[] } {
  let buffer = ''
  let eventName = ''
  let id: string | undefined
  let dataLines: string[] = []
  let sawData = false

  const takeField = (line: string): void => {
    if (line.startsWith(':')) return // 注释（保活心跳）：整行忽略
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    // 规范：冒号后紧跟的一个空格要去掉，之后的内容原样保留
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') eventName = value
    else if (field === 'id') id = value
    else if (field === 'data') {
      dataLines.push(value)
      sawData = true
    }
    // 其余字段（retry 等）本仓库不用，按规范忽略
  }

  const emit = (out: SseFrame[]): void => {
    if (sawData) out.push({ event: eventName || 'message', data: dataLines.join('\n'), id })
    eventName = ''
    id = undefined
    dataLines = []
    sawData = false
  }

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk
      const out: SseFrame[] = []
      // 按行切，最后一段可能是半行，留回缓冲等下一次 push
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '') {
          emit(out)
          continue
        }
        takeField(line)
      }
      return out
    },

    /**
     * 流结束了，把缓冲里的最后半行交出来。
     *
     * 为什么需要它：规范说帧由空行分隔，所以"没有以空行结尾的最后一帧"严格讲不算一帧。
     *   但对我们的供应商这条路，丢掉它的代价是具体的——网关发完最后一帧就直接关连接
     *   （不补那个空行）时，正文会被安静地截掉一截，而错误信息一个字都不会有。
     *   宁可多收一个不完整的尾巴，也不要少收一段内容。
     * 只在流真的结束时调用（EOF）：正常分帧的帧在 push 里就出来了，
     *   提前 flush 会把一个还在传输中的半行当成完整帧。
     */
    flush(): SseFrame[] {
      const out: SseFrame[] = []
      const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      buffer = ''
      if (tail !== '') takeField(tail)
      emit(out)
      return out
    },
  }
}
