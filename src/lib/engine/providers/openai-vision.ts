/**
 * openai-vision.ts —— 用多模态对话模型做「本页主角 vs 角色卡」的一致性比对
 *
 * 这是**一致性 Agent 的手**：它不决定重不重画，它只回答"这几条锚点对不对得上"。
 * 判定阈值与重画次数在 illustrate.ts，因为那是产品决策，不是模型能力。
 *
 * ★ 为什么判据是逐条清单而不是一句"像不像"：
 *   GLOSSARY「一致性分」写的是"它是判据不是事实，阈值靠人工判读校准"。
 *   要校准就得知道**它凭什么给这个分**。清单式提问让模型必须逐条回答，
 *   于是"0.71"旁边永远跟着"骨相：圆脸没画出来"——家长看得懂，我们也调得准阈值。
 */

import { EngineError } from '../errors.ts'
import type {
  CallBudget,
  CompareRequest,
  CompareResponse,
  PortraitAnalysisRequest,
  PortraitAnalysisResponse,
  PortraitAnalyzer,
  VisionComparator,
} from './types.ts'
import { requestJson, traceOf, type HttpDeps } from './http.ts'
import { extractJson } from '../../schemas/schema.ts'
import { ANCHOR_LABELS, ANCHOR_SLOTS, LOOK_TAGS, READ_SLOTS, type AnchorSlot } from '../domain.ts'

const SYSTEM = [
  '你是儿童绘本的角色一致性审核员。',
  '给你两张图：第一张是**标准像**（角色的唯一真相），第二张是**待审页**。',
  '只判断第二张里的主要人物与标准像是否为同一个孩子，不评价画得好不好、构图美不美。',
  '逐条核对给定的锚点清单。任何一条硬锚点不符，就要在 missed 里写出该条的槽位名。',
  '只输出 JSON：{"score":0 到 1 的小数,"missed":["槽位名"],"reason":"一句中文说明"}',
  '拿不准时把分打低，不要为了好看给高分——这个分数决定要不要重画，给高了就没人看得见那张崩脸。',
].join('\n')

/**
 * 读照片那条路的提示词（2026-10-15）。
 *
 * ★ 两条纪律与比对那条一样、理由也一样：
 *   ① **逐条答**（这里是"按槽位逐条描述"），于是每一句都能被家长对着照片核对；
 *   ② **只输出 JSON**，别寒暄。
 * ★ 三条不一样，都是刻意的：
 *   ① 温度仍是 0——这不是创作，是**读数**；
 *   ② 要求**只写看得见的**：看不见就写"看不清"，而不是补一个合理的猜测。
 *      这一条直接决定这张卡能不能用：编出来的锚点会跟着孩子进每一页。
 *   ③ 槽位名用 `ANCHOR_LABELS` 的中文（骨相/眼睛/…）。★ `ANCHOR_LABELS` 的注释写着
 *      "不进 prompt"——那条管的是**送进画图**的提示词；这里是送进**视觉模型的提问**，
 *      而中文槽位名正是给人读的那一套，模型按它回答、我们再映射回槽位。
 */
const ANALYZE_SYSTEM = [
  '你在帮一个家长把孩子的照片读成"角色锚点"——这是以后每一页插画都要照着画的依据。',
  '只描述**这张照片里看得见的东西**。看不见、被挡住、不清楚的槽位，值就写「看不清」，',
  '绝对不要按常识补一个合理的猜测——编出来的一条会跟着这个孩子进每一页。',
  // ★ 2026-10-16：这里原来举的例子是「圆脸、颊部饱满、下颌线软」——而它**就是**
  //   `DEFAULT_ANCHORS.bone` 那一行（第 3 步的预填示例）。实测两次里有一次模型把它
  //   **原样抄了回来**（`.out/vision-raw-2.log`：回来的骨相是「圆脸、颊部饱满、下颌线圆润」，
  //   头身比是「头身比约1:4、四肢圆润」，两句都是预填值），也就是说提示词自己递了一份答案，
  //   而家长拿到的是一份"读了我的照片"但其实是模板的东西。例子换成**抄不走的格式占位**。
  '每条一句中文短语：**形状 + 两处细节**，十来个字，例如「〈形状〉、〈细节〉、〈细节〉」',
  '——尖括号只是占位，**不许把我这些字抄进去**。',
  '不写情绪、不写场景、不写"很可爱"这类评价。',
  '只输出 JSON：{"anchors":{"骨相":"…","眼睛":"…","头发":"…","头身比":"…","肤色":"…",',
  '"特征记号":"…","常服":"…"},"lookTags":["从给定的标签里挑，看不出来就空数组"],"note":"一句中文"}',
  // ★ 「补充」（`extra`）**不在**要读的槽位里：它是家长自己写的那一格。
  //   这一句必须写出来——原来 user 那一段用 `ANCHOR_SLOTS` 列出了**八个**槽位（含「补充」），
  //   而这里的 JSON 范例只有**七个**键，两处互相矛盾。实测模型照着七个回（没有输出补充）。
  '「补充」那一格**不用你读**：那是家长自己写的一句话，不要输出它。',
].join('\n')

/**
 * 要读的槽位来自 `domain.ts` 的 `READ_SLOTS`（`ANCHOR_SLOTS` 去掉「补充」）。
 * ★ 判据只有一处：`/character/new` 那一屏也用它（"哪几格没读出来"的报数同源），
 *   两边各写一份的坏法就是这一刀踩到的那一个——槽位表里多一格，
 *   读照片那条路就去读一个不该它读的格子，而界面还会把"它没读出来"报给家长。
 *
 * ★ 槽位表（下面那道清单）与 system 最后那句禁令**必须同时存在**：
 *   只列清单不写禁令，模型照清单把「补充」也算一格；只写禁令不给清单，
 *   它就不知道要读哪几格。
 */

export function createOpenAiVision(
  deps: HttpDeps,
  modelId: string,
): VisionComparator & PortraitAnalyzer {
  return {
    id: `openai-vision(${modelId})`,
    modelId,
    async compare(req: CompareRequest, budget?: CallBudget): Promise<CompareResponse> {
      if (!deps.apiKey) {
        throw new EngineError(
          'provider-not-configured',
          'VISION_API_KEY / LLM_API_KEY 未配置，视觉比对不可用',
        )
      }
      const user = [
        {
          type: 'text',
          text: `锚点清单：\n${req.checklist.map((line, i) => `${i + 1}. ${line}`).join('\n')}`,
        },
        { type: 'image_url', image_url: { url: req.referenceDataUrl } },
        { type: 'text', text: '上面是标准像。' },
        { type: 'image_url', image_url: { url: req.pageDataUrl } },
        { type: 'text', text: '上面是待审页。按清单逐条核对后只输出 JSON。' },
      ]

      const body = await requestJson(deps, {
        method: 'POST',
        path: '/chat/completions',
        body: {
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          // 判定要稳定，不要发挥。温度 0 是这里唯一的选项。
          temperature: 0,
          max_tokens: 400,
        },
        signal: budget?.signal,
        // ★ 缺省 300s，不是 90s。这个调用一次要送**两张 1440×1440 的 data URL**
        //   （约 7 MB base64），90s 实测不够：live 跑书时 kimi-k2.6 做比对，
        //   多页直接回 504 或 fetch failed。而超时的代价是"这一页没核对"，
        //   它会让 r_redraw（§12.2 产出物 4）算不出来——所以宁等勿弃。
        //   同时**要认 deps.timeoutMs**：原来这里把它整个忽略了，
        //   于是 .env 里配多少都没用，配了也是白配。
        timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? 300_000,
      })

      const reply = readReply(body)
      const text = reply.text
      const parsed = parseLooseJson(text)
      if (!parsed) {
        return {
          score: null,
          missed: [],
          // ★ 这里**不**替它试第二次（读数可以重试，比对不行：比对一次要送两张 1440² 的图，
          //   而且它的产物是一个"没核对"的标记，重试的收益抵不上那次调用的代价）。
          //   但失败的原因照旧要说清，走的与读数同一条 `describeUnreadable`。
          reason: describeUnreadable(reply, 1, '比对'),
          modelId,
          traceId: traceOf(body) || undefined,
        }
      }
      const score = typeof parsed.score === 'number' ? clamp01(parsed.score) : null
      return {
        score,
        missed: Array.isArray(parsed.missed) ? parsed.missed.map(String) : [],
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        modelId,
        traceId: traceOf(body) || undefined,
      }
    },

    /**
     * 读一张照片，按八个槽位说这个孩子长什么样（2026-10-15）。
     *
     * ★ 与 `compare` 共用同一套 HTTP 管道（`requestJson` / `extractContent` /
     *   `parseLooseJson` / trace）：再写一条 fetch 只会多一处超时与多一处错误映射。
     * ★ 拿不到 JSON 时**抛**，不像比对那样回一个 `score: null`：比对的产物是一个分数，
     *   分数缺席还能记成"没核对"；而这里如果不抛，调用方会拿到一份**空锚点表**，
     *   然后把它当成"读到了、只是没内容"填进表单——那是静默的假成功。
     */
    async analyzePortrait(
      req: PortraitAnalysisRequest,
      budget?: CallBudget,
    ): Promise<PortraitAnalysisResponse> {
      if (!deps.apiKey) {
        throw new EngineError(
          'provider-not-configured',
          'VISION_API_KEY / LLM_API_KEY 未配置，读照片不可用',
        )
      }
      const slots = READ_SLOTS.map((slot) => `${ANCHOR_LABELS[slot]}（${slot}）`).join('、')
      // 已填的锚点里，空值与「补充」都不送：空的没有粒度可参考，补充是家长那一格
      const known = (req.anchors ?? []).filter(
        (anchor) => anchor.value.trim() !== '' && anchor.slot !== 'extra',
      )
      const user = [
        { type: 'text', text: `要读的槽位：${slots}` },
        ...(known.length > 0
          ? [
              {
                type: 'text',
                text:
                  '这个孩子**已经填过**的锚点（只用来告诉你"每条该细到什么程度"）：\n' +
                  known.map((anchor) => `${anchor.slot}: ${anchor.value}`).join('\n') +
                  '\n★ 它们多半和你眼前这张照片对不上——可能是别人写的，也可能是系统预填的示例。' +
                  '**一个字都不要沿用**：照片里是什么就写什么。',
              },
            ]
          : []),
        { type: 'text', text: `可选的标签只有这些：${LOOK_TAGS.join('、')}` },
        { type: 'image_url', image_url: { url: req.photoDataUrl } },
        { type: 'text', text: '上面是孩子的照片。按槽位逐条描述后只输出 JSON。' },
      ]

      /**
       * ★ 试两次（2026-10-16）。这件事**只对读数成立**，理由是它与出图那条路的区别：
       *   出图重试可能是一张重复扣费的图，读数重试只是一次很便宜的文本调用。
       * ★ 只重试"拿到了回包但里面没有能用的内容"，**不重试**任何抛出来的错：
       *   `requestJson` 里那条"4xx 一律不重试"是网络层的判据，这里不越过它
       *   （超出配额、余额不足那几种重试一百次也一样）。
       * ★ 这条不是凭感觉加的：`kimi-k2.6` 是**推理模型**，实测一次读照片
       *   要产 2400+ token 的思考链（`reasoning_tokens`），正文只有 250 字左右
       *   （`.out/vision-raw-2.log` / `-3.log`）。想完没写、或上游把正文截掉，
       *   都是这种模型**偶发**的坏法——而界面上那句话原来写的是"再点一次通常就好了"，
       *   等于把这一次重试交给家长手动做。现在引擎自己做掉。
       */
      const ATTEMPTS = 2
      let reply: Reply | null = null
      let parsed: Record<string, unknown> | null = null
      let traceId = ''
      for (let attempt = 1; attempt <= ATTEMPTS && !parsed; attempt += 1) {
        const body = await requestJson(deps, {
          method: 'POST',
          path: '/chat/completions',
          body: {
            model: modelId,
            messages: [
              { role: 'system', content: ANALYZE_SYSTEM },
              { role: 'user', content: user },
            ],
            // 读数，不是创作。温度 0 与比对那条同一个理由
            temperature: 0,
            max_tokens: 700,
          },
          signal: budget?.signal,
          // 只送**一张**图（比对那条送两张），所以缺省比 300s 短一档
          timeoutMs: budget?.timeoutMs ?? deps.timeoutMs ?? 180_000,
        })
        reply = readReply(body)
        parsed = parseLooseJson(reply.text)
        traceId = traceOf(body) || traceId
      }

      if (!parsed) {
        throw new EngineError('provider-bad-response', describeUnreadable(reply, ATTEMPTS))
      }

      return {
        anchors: anchorsFromAnalysis(parsed['anchors']),
        lookTags: lookTagsFromAnalysis(parsed['lookTags']),
        ...(typeof parsed['note'] === 'string' && parsed['note'].trim() !== ''
          ? { note: parsed['note'].trim() }
          : {}),
        modelId,
        ...(traceId ? { traceId } : {}),
      }
    },
  }
}

/**
 * 一个值太短就不算"读到了"。★ 门槛是 **2 个字**，不是 3：
 * 「圆脸」「短发」「单眼皮」都是真锚点（预填里那七条是 5–18 字，但短不等于没用），
 * 而 1 个字（「圆」）是噪声。这一条是写用例时把自己写错过的——第一版写了 3，
 * 于是「圆脸」被丢掉，而它明明是一条合格的锚点。
 */
const MIN_ANCHOR_LENGTH = 2

/**
 * 「读不出来」的哨兵值。★ 这一条是**提示词自己招来的**：`ANALYZE_SYSTEM` 要求
 * 模型对看不见的槽位写「看不清」（宁缺勿编）。那它就得在这里被认出来——
 * 否则「看不清」会**当成一条锚点填进表单**，然后进 prompt，然后在每一页里画出来。
 * ★ 用"包含"而不是"等于"：模型常写成「看不清，被挡住了」。
 */
const UNREAD_MARKERS = [
  '看不清',
  '看不见',
  '看不到',
  '不清楚',
  '无法判断',
  '无法确定',
  '未知',
  '不明',
  'n/a',
  'unknown',
]

/**
 * 模型回的锚点表 → 我们认识的槽位。**坏输入丢掉，不抛**。
 *
 * ★ 中文槽位名与英文槽位键都认：提示词给的是「骨相（bone）」这种带括号的形式，
 *   模型有可能只回中文名、也有可能回键名，两种都不该白扔。
 * ★ 认不出来的键**不进结果**（比如模型自己加了"表情"）——`ANCHOR_SLOTS` 是封闭的，
 *   多出来的槽位进不了卡（`buildCard` 会拒），在门口丢掉比在引擎深处抛错好。
 * ★ **丢掉的那几格由调用方负责**：这一层只回"读到了什么"，
 *   而"没读到的那些格原来是示例值、必须清掉"是界面的事（见 NewChild.tsx）——
 *   在引擎里替界面清，会让这条函数的语义变成"既读又改"。
 */
export function anchorsFromAnalysis(raw: unknown): { slot: string; value: string }[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const labelToSlot = new Map<string, AnchorSlot>(
    ANCHOR_SLOTS.map((slot) => [ANCHOR_LABELS[slot], slot]),
  )
  const out: { slot: string; value: string }[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (text.length < MIN_ANCHOR_LENGTH) continue
    const lowered = text.toLowerCase()
    if (UNREAD_MARKERS.some((marker) => lowered.includes(marker))) continue
    const cleaned = key.replace(/[（(].*?[)）]/g, '').trim()
    const slot = (ANCHOR_SLOTS as readonly string[]).includes(cleaned)
      ? (cleaned as AnchorSlot)
      : (labelToSlot.get(cleaned) ?? labelToSlot.get(key.trim()))
    if (!slot) continue
    if (out.some((anchor) => anchor.slot === slot)) continue
    out.push({ slot, value: text })
  }
  return out
}

/** 标签只保留清单里有的那些：模型爱自己造词（"大眼睛"），而表单里没有那一格 */
export function lookTagsFromAnalysis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Set<string>(LOOK_TAGS)
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    if (allowed.has(tag) && !out.includes(tag)) out.push(tag)
  }
  return out
}

/**
 * 回包里"模型到底写了什么"。**这一点在 2026-10-16 之前只有一个字段**（`content`），
 * 于是当模型想完没写时，我们手上的排障原文是**空的**——用户看到的就是那句
 * 「没按 JSON 回答（原文前 120 字：）」，括号里什么都没有，而它对我们自己也一样没用。
 *
 * ★ 四个字段都是实测出来的（`.out/probe-vision-raw.mts`，跑的是真 `kimi-k2.6`）：
 *   `message` 的键是 `content` / `role` / `reasoning_content` / `provider_specific_fields`，
 *   一次读照片的 `usage` 是 `completion_tokens 2526（其中 reasoning_tokens 2395）`——
 *   也就是说这个模型的**正文只有 250 字上下，思考链有 4000 字**。
 *   正文为空时，能解释"为什么"的东西全在另外三个字段里。
 */
type Reply = {
  /** `message.content`：模型**打算给你看**的那一段。空 = 它什么都没写 */
  text: string
  /** 思考链。★ 它**不是**答案，只在"没有答案"时用来解释为什么没有 */
  reasoning: string
  /** `stop` = 它自己说完了；`length` = 被截了；`content_filter` = 被安全策略掐了 */
  finishReason: string
  /** 有些家把拒绝写在 `refusal` 里（照片里是真人小孩时最该看的就是这个字段） */
  refusal: string
}

export function readReply(body: unknown): Reply {
  const message = findMessage(body)
  return {
    text: contentToText(message?.['content']),
    reasoning:
      typeof message?.['reasoning_content'] === 'string' ? message['reasoning_content'] : '',
    finishReason: findString(body, 'finish_reason'),
    refusal: typeof message?.['refusal'] === 'string' ? message['refusal'] : '',
  }
}

/**
 * `content` 有两种合法形状：字符串，或**分片数组**（`[{type:"text",text:"…"}]`，
 * 多模态回包常见）。老实现只认字符串，遇到数组形状会**静默回空串**——
 * 症状与"模型没写"一模一样，而那是两件完全不同的事。
 */
function contentToText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((part) =>
        part &&
        typeof part === 'object' &&
        typeof (part as Record<string, unknown>)['text'] === 'string'
          ? ((part as Record<string, unknown>)['text'] as string)
          : '',
      )
      .join('')
  }
  return ''
}

/** `choices[0].message`，但层级不一致是这家供应商的老毛病，所以留一层递归兜底 */
function findMessage(body: unknown): Record<string, unknown> | null {
  const choices = (body as Record<string, unknown> | null)?.['choices']
  const first = Array.isArray(choices)
    ? (choices[0] as Record<string, unknown> | undefined)
    : undefined
  const message = first?.['message']
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    return message as Record<string, unknown>
  }
  return (function walk(node: unknown): Record<string, unknown> | null {
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item)
        if (found) return found
      }
      return null
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if ('content' in record || 'reasoning_content' in record) return record
      for (const value of Object.values(record)) {
        const found = walk(value)
        if (found) return found
      }
    }
    return null
  })(body)
}

function findString(body: unknown, key: string): string {
  if (Array.isArray(body)) {
    for (const item of body) {
      const found = findString(item, key)
      if (found) return found
    }
    return ''
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    if (typeof record[key] === 'string') return record[key] as string
    for (const value of Object.values(record)) {
      const found = findString(value, key)
      if (found) return found
    }
  }
  return ''
}

/**
 * 「这一次没读出东西」到底长什么样。
 *
 * ★ 这一句是**给人看的排障原文**（它会原样出现在家长那一屏的括号里），所以它必须
 *   回答"哪一步空的"，而不是只留一个空括号：
 *   · 正文 0 字 → 说清是"想了但没写"，并把**思考链的末尾**带上（那才是当时的现场）；
 *   · 正文有字但解析不了 → 照旧带正文前 120 字；
 *   · 连思考链都没有 → 直说，那说明这个回包本身就是空的。
 */
export function describeUnreadable(reply: Reply | null, attempts: number, what = '读照片'): string {
  if (!reply) return `${what}的模型没有回任何内容。`
  const blank = reply.text.trim() === ''
  const facts = [
    reply.finishReason ? `finish_reason=${reply.finishReason}` : '',
    blank ? '正文 0 字' : `正文 ${reply.text.length} 字`,
    reply.reasoning ? `思考链 ${reply.reasoning.length} 字` : '',
    reply.refusal ? `refusal=${reply.refusal}` : '',
  ].filter((bit) => bit !== '')
  const scene = blank
    ? reply.reasoning
      ? `它思考的末尾：${reply.reasoning.slice(-160)}`
      : '回包里连思考链都没有（这一条是空回包）'
    : `正文前 120 字：${reply.text.slice(0, 120)}`
  return `${what}的模型没有按 JSON 回答（试了 ${attempts} 次；${facts.join(' · ')}）。${scene}`
}

/**
 * 模型偶尔把 JSON 包在 ```json 围栏里或前后带话，所以先抠出第一个平衡的 `{ }`。
 *
 * ★ 这段扫描器**原来在这里又写了一遍**（与 `schemas/schema.ts` 的 `extractJson` 是同一段
 *   "转义感知的括号深度扫描"），2026-10-15 合并掉了。合并的判据不是"看着像"，
 *   而是工单 01 §1.3 那条：**改一处必须记得改另一处**——例如转义括号那个边界，
 *   修了一处而漏了另一处，症状是"某个模型偶尔解析不出来"，而它俩长得一样、不好查。
 *
 * ★ 合并时**故意保留"从第一个 `{` 开始"这一步**，没有直接换成 `extractJson(text)`：
 *   后者会先看 `[`，于是 `[{"score":1}]` 这种回包会先被认成一个数组、
 *   再被判成"不是对象"而丢掉，而老实现能从里面抠出那个对象。
 *   合并是为了**少一份扫描器**，不是为了顺手改行为。
 */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const value = extractJson(text.slice(start))
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
