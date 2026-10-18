/**
 * voices/state.ts —— 「音色」这一件事的**唯一形状**（工单 06）
 *
 * ★ 这个文件是从 `lib/settings/state.ts` 里活下来的那一半。2026-10-16 用户定下
 *   「把前端用户自己输入 api-key 的模块取消了」之后，那个文件里的
 *   `SettingsForm` / `toEnv` / `storable` / `missingRequired` 全部作废（ADR-0009），
 *   但**音色不在作废之列**：用户 2026-10-16 同时定下了「音色仍由用户选（含自己录的）」。
 *   所以搬过来的是三样东西，一样不多：
 *
 *     1. 两个预置音色（`DEFAULT_VOICES`）——原样搬，连同那段实测记录；
 *     2. "当前选了哪一个"这一个字符串（原来住在 `settings.speech.voice` 里，
 *        2026-10-17 起住在服务端的 `voices` 表里）；
 *     3. "这本书会不会有朗读"这条判据（原来的 `speechReady`）。
 *
 * ★ `speechReady(settings)` 的判据**必须换掉**，这是这一轮最重要的一处语义变化。
 *   它的老判据是"用户填齐了 key + 模型 + 音色"——三个都在用户手上。
 *   现在这三样里有两样**不在用户手上**了：密钥是站长的、能不能用是站长放的权限。
 *   于是新判据是三条**分别来自三个地方**的事实：
 *
 *     · 站里配齐了语音吗   ← `GET /api/auth/me` 的 `configured`（服务端环境变量）
 *     · 这个人有创作权吗   ← 同一个响应的 `allowed`（一位；2026-10-18 之前是四个开关里的
 *                             `speech`，现在四项同真同假，见 ADR-0010）
 *     · 挑了一个音色吗     ← **账号上**（`GET /api/voices` 的 `current`；2026-10-17 之前在本机）
 *
 *   ★ 三条要**分开说**，不能合成一个布尔。合成之后字面上只有两种可能
 *   （"能用"/"不能用"），而用户看到"不能用"时下一步该做什么，恰恰取决于缺的是哪一条：
 *   找站长要权限、等站里配好、还是自己挑一个——这三句话没有一句能由另一句代替。
 *   所以导出的是 `narrationBlockOf()`，回一个**说出是哪一条**的值。
 */

/**
 * 一个音色选项。
 *
 * ★ 2026-10-16 换过一版（这条记下来，因为上一版的依据已经不成立了）：
 *   原来是 `longjielidou_v3.6`（男童声）+ `longpaopao_v3.6`（女童声），依据是
 *   2026-10-14 从文档里读到它们标着"儿童陪伴"、以及用户听过那三段样本。
 *   这一版是用户**在百炼控制台的音色库里自己挑的**：龙杰力豆 + 龙安灵希。
 *   所以 `tone` 一律用控制台自己的说法（截图 2026-10-16），
 *   而 `longjielidou_v3.6` 那条 10-14 的文档记录（儿童陪伴 · 5 岁男童）也一并留在注释里。
 *
 * ★ **没核到的就不写**：`longanlingxi` 只核到"可爱甜美音"这一句描述，
 *   它的年龄段、是否属于"儿童陪伴"档，我们**没有**核到——所以不写"5 岁女童"这种
 *   看起来对称、实际没依据的话（第一版注释就是这么写的，换表时必须一起改掉，
 *   留着就是注释在撒谎）。
 *
 * ★ 两个 id 在换表前**各打过一次真实 API**（`.out/tts-voice-probe.mjs`，
 *   语料就是 `PREVIEW_LINE` 那句）：
 *     `longjielidou_v3.6` → 200 · 1,414ms · 41,371 字节 · md5 a1b18194…
 *     `longanlingxi`      → 200 ·   708ms · 50,971 字节 · md5 cfd55a90…
 *   字节数不同 ⇒ 不是同一个声音回落到同一个音色上。★ 注意 `longanlingxi` **没有**
 *   `_v3.6` 后缀——百炼的 id 命名不统一（`longanxiaoxin` 无后缀、`longanhuan_v3.6` 有），
 *   所以后缀这件事只能实测确认，不能照着邻居推。
 */
export type VoiceOption = {
  /** 送进 TTS 的 `voice` 参数。机器名，与厂商控制台逐字一致 */
  id: string
  /** 界面上显示的名字。要按控制台原名找厂商音色时，看 `id` */
  name: string
  /** 厂商给的一句调性。★ 不带我们自己的形容词——"温暖""适合童书"不是我们能断言的 */
  tone: string
}

/** 两个预置音色。产品定义说"系统提供两个默认音色"，这里就是那两个 */
export const DEFAULT_VOICES: VoiceOption[] = [
  {
    id: 'longjielidou_v3.6',
    name: '豆豆',
    // 控制台里那一格的描述；仓库 2026-10-14 的文档记录另写着「儿童陪伴 · 5 岁男童」
    tone: '天真男童音',
  },
  {
    id: 'longanlingxi',
    name: '灵灵',
    tone: '可爱甜美音',
  },
]

/* ── 「我有哪些音色、在用哪一个」（服务端那一份的形状）────────────────────── */

/**
 * ★★ 2026-10-17（工单 16）：这一格**从本机搬到了账号上**。
 *
 * 原来它是一对 localStorage 函数（`loadCurrentVoice` / `saveCurrentVoice`）加
 * `store.ts` 里那一份"我录的"列表。搬走的理由只有一条，而它足够：
 * **换台设备就没了**——"我录的声音"看起来像账号的属性，却住在一台设备的浏览器里。
 * 用户 2026-10-17 定的口径是「音色一并挂到账号上」。
 *
 * ★ 那一对函数**删掉**了，不是留着当"这台设备上次选的"：两处都记着"当前是哪个"
 * 就是两份真相，而它们一定会打架（这台选 A、账号里是 B，下一次做书用哪个
 * 取决于先读了谁）。现在唯一的来源是服务端（`GET /api/voices`）。
 *
 * 形状与 Java 的 `VoiceController.Body` / `Row` 逐字段对应。
 */
export type MyVoice = {
  /** 厂商回的 voice_id（预置音色的那两个 id 也可能出现在这里：被选过就有一行） */
  voiceId: string
  /** 用户起的名字 */
  name: string
  /**
   * ★ 建它时的 TTS_MODEL。实测跨模型直接 400（`[cosyvoice]Engine error [411]`），
   *   所以这一条不是记账，是判据：当前模型与它对不上时，这张卡**不许选**
   *   （判在 `catalog.ts`）。
   */
  modelId: string
  /** 毫秒时间戳（服务端给的是 ISO 字符串，`parseMyVoices` 转过来） */
  createdAt: number
}

/** 这一组接口回的整份东西：我的音色 + 现在用哪一个 */
export type MyVoices = {
  voices: MyVoice[]
  /** 空串 = 还没挑（**不是 null**：界面上那一格就是一个字符串） */
  current: string
}

/**
 * 把服务端回的读成上面那个形状。**认不出就整份拒绝**（回 `null`），
 * 与 `admin/state.ts`、`auth/state.ts` 同一条纪律：半个列表比没有更坏——
 * 它会显示成"你只录过这一条"，而真相可能是"有两条，另一条没画出来"。
 */
export function parseMyVoices(raw: unknown): MyVoices | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const list = source['voices']
  const current = source['current']
  if (!Array.isArray(list) || typeof current !== 'string') return null

  const voices: MyVoice[] = []
  for (const item of list) {
    const one = parseMyVoice(item)
    if (!one) return null
    voices.push(one)
  }
  return { voices, current: current.trim() }
}

function parseMyVoice(raw: unknown): MyVoice | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const voiceId = str(item['voiceId'])
  const name = str(item['name'])
  const modelId = str(item['model'])
  const createdAt = Date.parse(str(item['createdAt']))
  // ★ 不 `as MyVoice` 硬转：这一份是**跨进程来的**，字段缺一个就该整份拒绝
  if (voiceId === '' || name === '' || !Number.isFinite(createdAt)) return null
  return { voiceId, name, modelId, createdAt }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/* ── 「这本书会不会有朗读」这一条判据 ─────────────────────────────────────── */

/**
 * 缺的是哪一条。★ `null` = 三条都齐。
 *
 * ★ 三个名字不是三个错误码，是**三句不同的话**：
 *   · `no-permission`          → 找站长开（带上联系方式）
 *   · `server-not-configured`  → 站里还没配好，谁都跑不了，等
 *   · `no-voice`               → 挑一个，你自己就能解决
 *   界面上把它们压成一句"语音还没配齐"，就把"你该做什么"这件事丢掉了。
 */
export type NarrationBlock = 'no-permission' | 'server-not-configured' | 'no-voice'

/** 「语音这条路本身通不通」——不带"挑没挑音色"。试听、克隆、删除要的是这一条 */
export type SpeechBlock = Exclude<NarrationBlock, 'no-voice'>

/**
 * 语音这条路通不通。★ 与 `narrationBlockOf` 分开是因为它们是**两个问题**：
 *   · "这次合成能不能发出去"（试听一条克隆音色、删掉它、克隆一条新的）——不要音色；
 *   · "这本书会不会有朗读"——还要挑一个音色。
 * 压成一个的话，`/voice` 那一屏上"听一句真的"会因为在挑音色的路上还没挑而不能按，
 * 而那颗钮按下去**正是去挑**。（`/api/voice/preview` 收的是显式 voiceId，
 * 服务端那边也确实不要"当前音色"。）
 */
export function speechBlockOf(given: {
  serverHasSpeech: boolean
  allowed: boolean
}): SpeechBlock | null {
  if (!given.allowed) return 'no-permission'
  if (!given.serverHasSpeech) return 'server-not-configured'
  return null
}

/**
 * 这一本会不会有朗读。**三条来自三个地方的事实**（见文件头），
 * 而且判据顺序是有讲究的：权限 → 服务端 → 自己的选择。
 * 反过来先报"你还没挑音色"的话，一个没权限的人会先去挑半天音色，然后还是不行。
 */
export function narrationBlockOf(given: {
  /** 站里配齐了语音吗（`GET /api/auth/me` 的 `configured.speech`） */
  serverHasSpeech: boolean
  /** 这个人有没有创作权（同一个响应的 `allowed`，一位） */
  allowed: boolean
  /** 挑了一个音色吗（本机那一格，非空即真） */
  voiceId: string
}): NarrationBlock | null {
  const speech = speechBlockOf(given)
  if (speech) return speech
  if (given.voiceId.trim() === '') return 'no-voice'
  return null
}

/**
 * 三句话，写在这里而不是散在七个调用点里。
 *
 * ★ 只有 `no-voice` 那一句是"你能自己解决的"；另外两句都不是用户能自己解决的事，
 *   所以它们**都带上联系方式**——一句"请联系管理员"而没说怎么联系，等于把人留在原地。
 *   （`mailto:` 的地址与 `AppShell` 页脚那一行是同一个，改要一起改。）
 */
export const CONTACT_EMAIL = '2953997419@qq.com'

export const NARRATION_BLOCK_MESSAGE: Record<NarrationBlock, string> = {
  'no-permission': `你的账号没有创作权限（站长可以收回这一项），朗读用不了。要开请联系 ${CONTACT_EMAIL}`,
  'server-not-configured': `站里还没有配好语音，朗读暂时用不了——这不是你能改的，等一等；等不到就说一声 ${CONTACT_EMAIL}`,
  'no-voice': '还没挑音色——去「声音」那一屏挑一个，之后每本书都用它念',
}
