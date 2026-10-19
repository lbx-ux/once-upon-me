/**
 * narrate.ts —— ④ 逐页配音（TTS 在 W2 时留的是 `voice: null` 的 seam，这里是第一个消费方）
 *
 * 与 `illustrate.ts` 同构：逐页串行、失败不终止整条流、每条产出都发事件。
 * 但它比出图简单得多——没有一致性校验、没有重画、没有"像不像"这件事。
 *
 * ★ 四条不显然的规则：
 *
 * 1. **去重键是 `(voiceId, mood, textHash)`，不是页码**。共读版的故事树里主干页会被多个
 *    分支共用，同一段正文合成两次是白花钱；`domain.ts` 的 `Narration` 注释早就把
 *    这个键写死了。复用的那几页 `asset` 指向**同一个文件**（`reused: true`），
 *    所以磁盘上不会有 `page-7-a1.mp3`——这不是漏了，是它们本来就是一份录音。
 *    ★ mood 那一节是 2026-10-19 加的：接上情绪标签之后，**同一段文字换个语气
 *    就是另一份录音**（叠句在多页之间语气不同是正常的），拿文本哈希当键会让
 *    第二页**静默复用**第一页的平调录音。
 * 2. **正文用 `body.join('')` 拼接，不加空格**。这不是随手写的：实测那句
 *    "哗啦啦，大雨落下来。地上变成亮晶晶的河。"（两句直接相连）合成出来约 2.5 秒，
 *    这个数是按 `join('')` 量的。改成 `join(' ')` 会插进一个未经测量的停顿，
 *    要把 §1.2c 的时长与体积估算一起重测。
 * 3. **一页配不上音不影响别的页，但必须留下痕迹**。所以这里抛出的错会被
 *    `narrateAll` 收成 `{pageNo, message}` 并补一条非致命的 `error` 事件——
 *    书照样装订，但"这一页没声音"是可查的，不是静默的。
 *    （这条对应 app-restructure spec 里"要么整本书都能响"那个判据：
 *    接线之前先要看清整本到底响不响。）
 * 4. **`mood` 走到了合成，`pronunciation` 仍然没接**。情绪标签 2026-10-19 接上了：
 *    `node.mood` 一路传到 `synthesize`，由适配器翻成厂商的控制类标签
 *    （`qwen-speech.ts` 的 `MOOD_TAGS`，实测记录在 `docs/known-tradeoffs.md`）。
 *    这一层**不认识任何标签串**——它只搬运 `Mood` 这个与供应商无关的领域词。
 *    ★ 同一段文字**换个 mood 就是另一份录音**，所以去重键多了 mood 这一节（规则 1）。
 *    `pronunciation`（读音纠正）仍然缺席：它要 SSML 的音素控制，**没测过**，
 *    放进适配器会直接报错。宁可让这一样缺席，也不要让"名字念错了"无人知道。
 *
 * ★ 2026-10-16（工单 01）：循环体抽成了导出的 `narrateNode`，`narrateAll` 改成循环调它。
 *   两个理由：**单页重配**要能只合成一页；而"这一页正在配音"这句话原来**说不出来**——
 *   `narrateAll` 只发不带 `pageNo` 的那一对 stage 事件。现在 `narrateNode` 在合成前后
 *   各发一条**带页码**的，`frames.ts` 的 `Frame.busy = 'voicing'` 就是从它推的。
 *   抽出来而不是复制一份：去重表（规则 1）只有一份实现。
 */

import { digest } from './digest.ts'
import { asEngineError } from './errors.ts'
import { extensionOf } from './providers/stores.ts'
import { NARRATION_PART_LABELS } from './domain.ts'
import type { Mood, Narration, NarrationPart, StoryNode } from './domain.ts'
import type { EngineEventPayload } from './events.ts'
import type { AssetStore, VoiceSynthesizer } from './providers/types.ts'

export type NarrateOptions = {
  /** null 时调用方不该进这一层（见 index.ts 的非致命事件） */
  voice: VoiceSynthesizer
  /** 用哪个音色。默认音色与克隆音色在这里没有区别——都是厂商侧的一个 id */
  voiceId: string
  store: AssetStore
  bookId: string
  emit: (payload: EngineEventPayload) => void
  /**
   * 本轮已经合成过的录音，键 = `${voiceId}:${mood}:${textHash}`（规则 1）。
   * ★ 由调用方建、由这一层读写：去重表只有这一份实现，`narrateAll` 与单页重配共用它。
   *   不传 = 每一次都重新合成。
   */
  done?: Map<string, Narration>
  /**
   * 这一份录音的**第几版**，进文件名（`page-7-a{takeNo}.mp3`）。缺省 1。
   * ★ 单页重配要传 `nextTakeNo(旧路径)`（工单 01）：旧的那份**留着**——
   *   与 illustrate.ts 第 3 条"失败的图也落盘"是同一条纪律，
   *   只是这里的价值不同（录音没有"像不像"可比），所以它只值一条注释，不值一次比对。
   */
  takeNo?: number
}

export type NarrateResult = {
  narrations: Narration[]
  /** 没配上音的页。★ 与"这本书没有配音"是两件事，别合并 */
  errors: { pageNo: number; message: string }[]
}

/** 一页要念的正文。规则 2：`join('')`，不是 `join(' ')` */
export function narrationTextOf(node: StoryNode): string {
  return node.body.join('')
}

/**
 * 片段 → 文件名里那一截。**正文那一档是空串**，于是 `page-3-a1.mp3` 这个名字
 * 与加共读版之前**逐字节相同**——盘上已有的书、以及所有拿旧名字做的断言都不受影响。
 */
const PART_SUFFIX: Record<NarrationPart, string> = {
  body: '',
  prompt: '-prompt',
  'option-a': '-opt-a',
  'option-b': '-opt-b',
}

/** 一段要合成的东西：哪一页、哪一段、念什么、用什么语气 */
export type NarrationTarget = {
  pageNo: number
  part: NarrationPart
  text: string
  /**
   * 这一段的语气，取自**这一页的** `node.mood`（四段共用一页的一个词）。
   *
   * ★ 为什么四段共用而不是给引导提问/两个选项各配一套：`mood` 在 `domain.ts` 里定义的
   *   就是"这一页的情绪"，而多一张"哪一段该用什么语气"的表就是多一处会漂的真相。
   *   `tense` 页的引导提问（家长念的那一句）会不会因此显得怪，**是没量过的事**——
   *   真撞上了再加第二张表，不预先拍。
   */
  mood: Mood
}

/**
 * 一页要合成的**全部**片段：正文，加上（这一页是选择点时）提问与两侧选项。
 *
 * ★ 选择点那三段不是"顺手加的"：产品定义里选项走「**大图标 + 语音朗读**双通道」，
 *   而孩子不识字——`label` 给眼睛看，`spoken` 就是那个耳朵通道。
 *   `prompt`（给家长念的引导提问）也要有声音，因为家长不在的那几秒，
 *   这一页至少得能自己把问题说出来。
 * ★ 空文本**不进这一层**（调用方按 `text.trim() === ''` 筛）：
 *   与"没有正文就不合成"同一条——拿空串去要音频，厂商那边要么报错要么回一段静音，
 *   而两种都不会在界面上说清"这一页没有这句话"。
 */
export function targetsOfNode(node: StoryNode): NarrationTarget[] {
  const targets: NarrationTarget[] = [
    { pageNo: node.pageNo, part: 'body', text: narrationTextOf(node), mood: node.mood },
  ]
  const choice = node.choice
  if (choice) {
    const [a, b] = choice.options
    targets.push(
      { pageNo: node.pageNo, part: 'prompt', text: choice.prompt, mood: node.mood },
      { pageNo: node.pageNo, part: 'option-a', text: a.spoken, mood: node.mood },
      { pageNo: node.pageNo, part: 'option-b', text: b.spoken, mood: node.mood },
    )
  }
  return targets
}

/**
 * 一份录音落盘时的第几版：`books/x/page-7-a2.mp3` → 3。认不出来（没有那一页、名字不是
 * 这一套）就从 1 起。
 *
 * ★ 单独一个函数是为了它**能被测**：这段解析埋在 `rerunNarration` 里的话，
 *   "第三版会不会覆盖第二版"这件事只有真跑一本书才知道。
 * ★ 它对四个片段**都成立**：`page-3-opt-a-a1.mp3` 尾上也是 `-a1.`，
 *   而正则只认**第一个** `-a<数字>.`，所以每一段各自数各自的版本号。
 */
export function nextTakeNo(previousPath: string | undefined): number {
  const matched = previousPath?.match(/-a(\d+)\.[a-z0-9]+$/i)
  return matched ? Number(matched[1]) + 1 : 1
}

/**
 * 合成**一段**。单页重配与整本都走它（工单 01 §五）。
 *
 * 三件事按顺序发生，缺一不可：
 * 1. 带 `pageNo` 的 `stage(begin, narrating)` —— ★ 这条是**新加的**：
 *    原来 `narrateAll` 只发不带页码的那一对，于是没有任何东西说得清"**这一页**正在配音"。
 *    `frames.ts` 的 `Frame.busy = 'voicing'` 就是从它推出来的。
 * 2. 合成 + 落盘（路径带 `part` 与 `takeNo`）。
 * 3. 带 `pageNo` 的 `stage(end, narrating)`。
 *
 * ★ 空文本**不进这一层**（调用方筛掉它）。
 */
export async function narrateTarget(
  target: NarrationTarget,
  opts: NarrateOptions,
): Promise<{ narration: Narration; reused: boolean }> {
  const textHash = digest(target.text)
  // 规则 1：键里带 mood —— 同一段文字换个语气是**另一份录音**，不带它就会静默复用平调那份
  const key = `${opts.voiceId}:${target.mood}:${textHash}`

  // 规则 1：同一份录音只落一次盘，多处共用同一个 asset。
  // ★ 复用的那一份带着**它第一次落盘时的 part**，所以这里要把 `part` 覆写成本次的那一个——
  //   两个选项写成同一句话时，它们指向同一个文件，而各自都得说清"我是哪一段"。
  const reused = opts.done?.get(key)
  if (reused) {
    const narration: Narration = { ...reused, pageNo: target.pageNo, part: target.part }
    opts.emit({
      kind: 'narration',
      stage: 'narrating',
      pageNo: target.pageNo,
      part: target.part,
      voiceId: opts.voiceId,
      assetPath: reused.asset.path,
      reused: true,
    })
    return { narration, reused: true }
  }

  opts.emit({ kind: 'stage', stage: 'narrating', phase: 'begin', pageNo: target.pageNo })
  try {
    const response = await opts.voice.synthesize({
      voiceId: opts.voiceId,
      text: target.text,
      mood: target.mood,
    })
    const asset = await opts.store.put({
      path: `books/${opts.bookId}/page-${target.pageNo}${PART_SUFFIX[target.part]}-a${opts.takeNo ?? 1}${extensionOf(response.mime)}`,
      bytes: response.bytes,
      mime: response.mime,
    })
    const entry: Narration = {
      pageNo: target.pageNo,
      part: target.part,
      voiceId: opts.voiceId,
      textHash,
      asset,
    }
    opts.done?.set(key, entry)
    opts.emit({
      kind: 'narration',
      stage: 'narrating',
      pageNo: target.pageNo,
      part: target.part,
      voiceId: opts.voiceId,
      assetPath: asset.path,
      reused: false,
    })
    return { narration: entry, reused: false }
  } finally {
    // ★ 收尾那一条放在 `finally`：合成失败时这一格不该永远停在"正在配音"上——
    //   那正是"界面撒谎"的最小样本（图上会一直转，而服务端早就放弃了）
    opts.emit({ kind: 'stage', stage: 'narrating', phase: 'end', pageNo: target.pageNo })
  }
}

/**
 * 合成**这一页的正文**那一份。单页重配（`rerunNarration`）与测试走它。
 * ★ 选择点那三段也归那一页，所以单页重配走的是 `targetsOfNode` 把三段一起过一遍——
 *   只重配正文的话，换了音色之后**选择点还是旧声音**，而界面上没有任何东西会提示这件事。
 */
export async function narrateNode(
  node: StoryNode,
  opts: NarrateOptions,
): Promise<{ narration: Narration; reused: boolean }> {
  return narrateTarget(
    { pageNo: node.pageNo, part: 'body', text: narrationTextOf(node), mood: node.mood },
    opts,
  )
}

export async function narrateAll(
  nodes: readonly StoryNode[],
  opts: NarrateOptions,
): Promise<NarrateResult> {
  const narrations: Narration[] = []
  const errors: { pageNo: number; message: string }[] = []
  /** key = `${voiceId}:${mood}:${textHash}` → 已经落盘的那份录音（跨页去重，见规则 1） */
  const done = new Map<string, Narration>()

  opts.emit({ kind: 'stage', stage: 'narrating', phase: 'begin' })

  // ★ 换了一个不认情绪标签的模型时，**不能让这件事静默发生**：症状恰好是当初那个 bug 的样子
  //   ——"每一页都读成同一个调子"，而界面上没有任何东西说得清为什么。
  //   所以补一条非致命事件（与"这一页没配上音"同一条用法：book 照装订，但这句话可查）。
  //   只在真的会丢东西时发：全是 `calm` 的书本来就不发标签，那一条会变成噪音。
  if (!opts.voice.supportsMood && nodes.some((node) => node.mood !== 'calm')) {
    opts.emit({
      kind: 'error',
      stage: 'narrating',
      code: 'mood-tags-unsupported',
      message:
        `这个语音模型（${opts.voice.modelId}）不支持情绪标签，所以这一本的朗读是**平调**的——` +
        '原文照念，但没有语气起伏。要听出语气请换 qwen-audio-3.1-tts-flash / ' +
        'qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-flash 之一再重配。' +
        '（配音照样会跑完，书照样装订，只是没有语气。）',
      fatal: false,
    })
  }

  for (const node of nodes) {
    for (const target of targetsOfNode(node)) {
      if (target.text.trim() === '') {
        // 空文本不合成。★ 不报错也不留空文件：没有这句话本来就没有配音这回事
        continue
      }
      try {
        const { narration } = await narrateTarget(target, { ...opts, done })
        narrations.push(narration)
      } catch (err) {
        const failure = asEngineError(err)
        // ★ 报错要点名**是哪一段**（正文 / 引导提问 / 选项 A / 选项 B）：
        //   一页现在最多四段，只说"这一页没配上音"，家长不知道缺的是哪一句
        const label = NARRATION_PART_LABELS[target.part]
        const what = target.part === 'body' ? '这一页' : `这一页的${label}`
        errors.push({ pageNo: target.pageNo, message: `${what}没配上音：${failure.message}` })
        opts.emit({
          kind: 'error',
          stage: 'narrating',
          pageNo: target.pageNo,
          code: failure.code,
          message: `${what}没配上音：${failure.message}`,
          fatal: false,
        })
      }
    }
  }

  opts.emit({ kind: 'stage', stage: 'narrating', phase: 'end' })
  return { narrations, errors }
}
