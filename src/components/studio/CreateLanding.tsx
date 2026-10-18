'use client'

/**
 * CreateLanding —— 工作台「创作」那一屏：一句话进去
 *
 * 版式（2026-10-15 与首页并成同一世界之后）：左对齐的标题 → 两颗胶囊 →
 * 一张纸（输入区 / 分隔线 / **左边两颗工具 + 右边「开始创作」**）→
 * **12 个主题的封面墙**。
 * ★ 2026-10-16 到 2026-10-18 之间，标题**上方**还有一行「书的形态」（`.cl__forms`，
 *   居中、两颗按钮、共读版那颗写着「还没做」）。**那一行用户 2026-10-18 要求撤掉了**，
 *   现在这一屏上没有任何形态控件。
 *   撤的理由不是"少一个控件"：形态换的是**这一本怎么做**，与"几页""要不要朗读"
 *   是同一类问题，所以它搬进了点「开始创作」之后那个弹窗的**第一问**
 *   （见 `GenerationSetupDialog` 判断 1，那里也是唯一一处解释这两个词的地方）。
 *   ★ 撤掉的是一个**当时只有一档能选**的分段控件（另一档真 `disabled`）——
 *     所以这里没有丢任何"用户能做的动作"，丢的是"产品有两种形态"这件事实的可见性。
 *     那一行原来那三段判断（为什么它能在"没有第二个值"的情况下站住、为什么它是居中
 *     的不对称、为什么「还没做」不做低对比）随它一起删掉了；这一条是它剩下的全部记录。
 *
 * ★ 2026-10-15 按用户要求删掉这**两行字**，别把它们当成漏了：
 *   1. 标题下那行说明（`.cl__sub`，"选好小主角和声音…"）
 *   2. 输入框下那行小字（`.cl__hint`，"一句话就够…"）
 *   3. 那句语音警示（`.cl__warn` 原来那一句，"语音的 Key 或模型名还没填…"）
 *   留下的只有"他必须看见的那几件"：两颗胶囊、输入框，以及动作栏里那三颗按钮。
 *
 * ★ 2026-10-16 两个下拉各**减一行**，都是用户要求（"只显示照片和姓名就行，
 *   不用写那么多"）：
 *   1. 小主角那一项后面的「第 N 版 · <模型名> 画的」**撤了**。那是**卡的历史**，
 *      做卡的人（`/character`）才需要它；在这里，"哪张卡"由头像和名字就说完了，
 *      而且这行字每一张都长得一样，占着位置却不帮人做选择。
 *      `revision` / `modelId` 仍在数据里（`/character` 那一屏照旧念），这里只是不显示。
 *   2. 声音那一项后面的机器名（`longjielidou_v3.6`）**撤了**，只留调性
 *      （"天真男童音"）。这一条推翻的是本文件原来那句"机器名照旧念出来，
 *      名字对得上，去 `/voice` 才找得到那一张卡"——那句话在当时是对的，
 *      现在不对了，因为**这个下拉里已经不再通往 `/voice`**（见下面第 4 条）：
 *      对不上号这个代价没有了，而机器名对选购者本来就零信息。
 *      ★ 代价要写明白：**在这一屏选声音，从今往后只能靠"天真男童音"这四个字**，
 *        听不到。`/voice` 那一屏（侧栏「声音」进得去）每张卡照样能听一句真的，
 *        但这个下拉不再指过去。若哪天觉得"盲选"这件事变严重了，
 *        该修的是**在这里放试听**，不是把机器名加回来。
 *   4. 下拉底部那条「先去听一句真的 →」**撤了**（用户划掉的）。判断没变——
 *      选音色确实没法靠文字判断——变的是**摆法**：一个下拉里塞第三条腿，
 *      比没有这条腿更乱。`/voice` 仍在侧栏上，没有变成走不到的路。
 *
 * ★ 「优化提示词」与「换一句」**搬过一次家，也没有删过**——记在这里免得再被误读一遍：
 *   它们原来挤在动作栏的**右边**（和主按钮抢同一处视线），用户要求挪到**左边**、
 *   并且**去掉可见文字只留图标**。所以动作栏是 `[左：两颗图标] …… [右：开始创作]`。
 *   这个排法不只是好看：右边那颗是**离开这一屏**的动作，左边两颗是**改框里这句话**
 *   的动作，两者不是一件事，本来就不该并排。
 *   ★ 只有图标就**必须**补 `aria-label`（否则读屏念到的是一颗匿名按钮），
 *     而且"正在想…"那件事也要换个方式说——现在靠 `data-busy` 的呼吸 + `aria-busy`。
 *   ★ 优化那一颗必须长在**它真正作用的输入框**旁边（工单 07 §一）：
 *     长在主题那一行，用户会以为"挑了恐龙再优化"会变成另一只恐龙。
 *   ★ 2026-10-18：**骰子换了它的那一份数据**（用户："现在这个随机选取并不是真正的
 *     随机，只是按顺序从下面 12 个主题里面选取"）。它原来读主题墙那 12 句、按顺序转，
 *     现在读 `lib/creation/inspirations.ts` 那个 72 条的池子，洗一副牌一张张发。
 *     位置、长相、可访问名都没动——动的是它抽的是哪一份表，以及**抽到不带主题那句时
 *     会把主题清空**（墙上没有一格亮着，站回默认形象）。
 *
 * ★ 它**不自己造一套表单**：这一句话交给 `/create?wish=…&theme=…&card=…`，
 *   创作流里那四步（孩子 / 想讲什么 / 角色卡 / 生成）一步都不少。
 *   也就是说这一屏是**入口**，不是另一条生成路径——两条路径迟早会漂。
 *
 * 五处与最初那版参考图不同，都是刻意的：
 *   1. 提示语写"想讲什么故事"，不写参考图那句"描述要生成的画面"——
 *      这个产品生成的是**书**，不是图。说成画面会让人以为只出一张图。
 *   2. 画风那一格**撤了**（原来是"一个事实"的只读胶囊）。撤的理由是它连事实都省了：
 *      产品只有一档画风（`DEFAULT_STYLE_FRAGMENT`，建卡时写死 warm-handdrawn），
 *      一个用户动不了的格子占着"可选项"的位置，只是在数这一屏还剩几个格子。
 *      画风的事实仍写在**需要它**的地方——`/character` 那一屏的建卡说明。
 *   3. 参考图里那颗"分享/导出"样的图标没做：这一屏没有可分享的东西（书还没生成）。
 *      一颗点了没反应的按钮不如没有。
 *   4. 原来那三句建议卡（各带一枚 emoji）已被**主题墙整块取代**：
 *      12 个主题各一张水彩封面，点一下填进输入框。emoji 因此在这一屏彻底消失——
 *      首页 §五 早就写过"emoji 是扁平高饱和的 clip-art，与水彩是两套画法"，
 *      主页留着它，两屏放在一起会互相拆台。
 *   5. 参考图那颗小人**搬过来了，但换了做法**：输入卡右上角站着一个全身的孩子
 *      （`.cl__figure`，12 张之一，出自 `public/figures/`）。两处不同是刻意的——
 *      **全身不切割**（参考做法把他下半身藏进纸里，那需要一套层叠戏法，而且
 *      "只对着一张输入框露半个人"不是这一屏想说的话）；**不是 3D 盲盒质感**
 *      （与第 4 条同一判断：一个树脂公仔站在 12 张水彩旁边是两套画法互相拆台）。
 *      ★ **他只跟着主题墙走，没有第二个来源**：点「鲸鱼」封面，站上来的就是鲸鱼
 *        那张里的孩子；没挑主题时站 `DEFAULT_FIGURE`。这一句就是全部规则——
 *        曾经有过"侧栏手动换人、手动值覆盖主题"那一套，已按用户要求**整块拆掉**
 *        （连 `FigureProvider` / `figure-pref` / `FigurePicker` 一起删掉，见
 *        README §五）。所以现在这里是**一条推导**，不是一个会被谁改掉的状态：
 *        `figure = theme ?? DEFAULT_FIGURE`。将来若要按用户记住形象（登录之后那件事），
 *        它是**另一件事**——不要顺手在这里加一个 override 回来。
 *
 * ★ 两格都是**真控件**，一个假的都没有：小主角那一格列已经存在的卡，
 *   声音那一格列 `SettingsProvider` 那张表（预设 + 我录的，见 `lib/voices/catalog.ts`）。
 *   ★ 声音这一格不新造状态：它写的是 `VoiceProvider` 的 `current`，与 `/voice` 那一屏
 *     `VoicePicker.tsx` 是**同一个字段、同一个 `patch`**。所以在这里选完，
 *     点「开始创作」进去的那一次生成就已经是它了——不需要再往 URL 上挂一个 voice 参数
 *     （`/create` 那一边本来就从设置里读 `env`）。一个值只有一个家。
 *   ★ 它**不做试听**。`VoicePicker.tsx` 的文件头写着选音色这件事没法用文字判断——
 *     那句判断没变，所以我不能靠一句"看名字挑"就完事。原来的做法是下拉底部给一条
 *     通到 `/voice` 的路，而**不是**把试听那 ~30 行 fetch + Blob 复制第二份
 *     （一个行为两个实现，迟早有一份先烂）；2026-10-16 那条路**也撤了**（见文件头
 *     上面那一节）。★ 所以这里现在是一个**盲选**的下拉，这是已知代价，不是遗漏：
 *     真要补，补的是试听本身，不是把机器名加回来。
 *
 * ★ 「小主角」那一格只列**已经存在的卡**，头像取 240 档（实测 10 KB）。
 *   上一版刻意不放头像，理由是"原图 2,772,224 字节，不该为一个 20px 的圆点拉两兆多"——
 *   那个判断没错，错的是当时没有缩略图这条路。现在有了（`lib/thumbs.ts`），判断跟着改。
 *   名字读不到时退回 childId（机器名），不编一个好听的说。
 *   ★ 例外只有一处：**示例卡**的头像是 768 那一张（23 / 26 KB），因为访客那一支
 *     拿的是 `public/` 下的静态文件，而静态文件看不懂 `?w=`（见 `listDemoCardPicker`）。
 *     界面这一层不为此分岔——它照旧只认 `faceUrl` 这个字段。
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { ofTheme } from '@/lib/creation/example-wishes.ts'
import { drawInspiration, INSPIRATION_POOL } from '@/lib/creation/inspirations.ts'
import { DEFAULT_FIGURE, figurePath } from '@/lib/figures.ts'
import { forgetThemes, peekThemes, themeArrival } from '@/lib/theme-handoff.ts'
import { THEMES, themeCardPath, type ThemeKey } from '@/lib/themes.ts'
import { useEnterTimeline } from '@/lib/useEnterTimeline.ts'
import { useVoice } from '@/components/voices/VoiceProvider.tsx'
import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { useSignInGate } from '@/components/auth/SignInGate.tsx'
import { canCreate } from '@/lib/auth/state.ts'
import GenerationSetupDialog, { type SetupChoice } from './GenerationSetupDialog.tsx'

export type ChildOption = {
  cardId: string
  childId: string
  revision: number
  modelId: string
  /** 档案层读到的名字。★ 可选不是装饰性的省略：卡上本来没有名字这个字段 */
  label?: string
  /** 240 档的头像 URL */
  faceUrl: string
}

export default function CreateLanding({ cards }: { cards: ChildOption[] }) {
  const router = useRouter()
  const { current: voiceId, setVoice, voices, voiceError } = useVoice()
  const { allowed: mayCreate, configured } = useAuth()
  /* ★ 三处"要登录才能做"的入口各有一份，共用一个 hook（`SignInGate`）：
     创作（这里）、生成人物（`NewCharacterButton`）、生成声音（`VoicePicker`）。 */
  const gate = useSignInGate()
  const rootRef = useRef<HTMLElement>(null)
  const [wish, setWish] = useState('')
  /* 主题（以及由它推出来的「站着的是谁」）就住在这里。
     ★ 它一度被搬到 `FigureProvider` 里，因为当时侧栏还有一颗换人的按钮要读它；
        那颗按钮拆掉之后，这里就是唯一的家，于是搬回来——**留一个只有一个读者的
        Provider 是给假想的将来搭架子**，不是省事。 */
  const [theme, setTheme] = useState<ThemeKey | null>(null)
  /* ★ 一条推导，不是一个状态：立绘只跟着主题走（见文件头 5） */
  const figure = theme ?? DEFAULT_FIGURE
  /**
   * 「换一句」那副牌（2026-10-18）。
   *
   * ★ 两个 ref，不是 state：它们是**发牌机**的内部状态，画面上一个像素都不由它们决定
   *   （屏幕上变的是 `wish` 与 `theme` 那两条 state）。写成 state 只会多两次重渲染。
   *   ★ 这也顺手避开了严格模式那条坑：初始化器会被跑两次，而这里只在**点击**里写。
   *
   * ★ 为什么不是"每次随便取个下标"：真正的随机**会连着给同一条**，用户看到的是
   *   "这颗按钮坏了"。发牌保证一轮 72 条之内不重复（`drawInspiration`）。
   * ★ 在这之前这里是 `exampleAt` 一个计数器，读的是主题墙那 12 句——用户
   *   "现在这个随机选取并不是真正的随机"说的就是它：连按 12 下必然回到原句。
   */
  const deckRef = useRef<number[]>([])
  const lastRef = useRef(-1)
  /** 哪一格的下拉开着。★ 一个状态而不是两个布尔：两格同时开着是画不出来的 */
  const [open, setOpen] = useState<'card' | 'voice' | null>(null)
  /** 「这一本要怎么做」那个弹窗开着没有（工单 04）。★ 与上面那个 `open` 分开：
   *  那两格是页面上的弹出层，这个是**模态**，Esc 与焦点的规矩都不一样 */
  const [setupOpen, setSetupOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const voiceRef = useRef<HTMLDivElement>(null)
  /** 弹窗关掉之后焦点要回的那一颗（`startRun` 那条不走——它把人带离了这一屏） */
  const goRef = useRef<HTMLButtonElement>(null)

  /* ── 优化那句话（工单 07）───────────────────────────────────────────────
   * ★ 四条状态而不是一条：一条的话，"正在想"和"没改成"会共用一个位，
   *   于是失败时那句建议会消失（用户刚看到一句话又没了）。
   * ★ 建议**不覆盖原句**。`suggest.original` 就是提出建议那一刻框里的那一句——
   *   撤销要有东西可退，所以它必须存下来，而不是"反正用户自己记得"。 */
  const [suggest, setSuggest] = useState<{
    text: string
    tooLong: boolean
    /** ★ 建议**不覆盖原句**。这就是提出建议那一刻框里的那一句——
     *  撤销要有东西可退，所以它必须存下来，而不是"反正用户自己记得"。
     *  ★ 这里原来还存着 `modelId`（"这一版是哪个模型改的"），2026-10-16 删了：
     *  用户要求"不用告诉用户是什么模型生成的"。**接口照旧返回它**，不读而已
     *  （`/api/optimize` 那边留着它是为了"优化结果被投诉时要答得上"）。
     *  一个读进来只为了摆在屏幕上的字段，屏幕不摆了，它就该跟着走。 */
    original: string
  } | null>(null)
  const [thinking, setThinking] = useState(false)
  /**
   * ★ 防双发的判据是 **ref，不是 state**。
   *   写成 `if (thinking) return` 是错的：React 的重渲染是异步排的，
   *   同一帧里来的第二次点击，handler 拿到的还是旧的 `thinking`（false），
   *   于是两个请求一起飞出去。这不是理论——2026-10-15 实测过一次：
   *   state 版本连点两下，桩服务器收到 `SLOW-REQ#1`、`SLOW-REQ#2` 两条。
   *   `disabled` 属性也拦不住同帧的第二下（它同样要等重渲染才生效）。
   *   state 只负责**看起来**在忙（按钮文案与禁用态），ref 负责**真的**只有一个在飞。
   */
  const thinkingRef = useRef(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  /* ── 接力：从首页点「开始创作」进来的那一次（2026-10-16）────────────────────
   * 主题墙上那 12 格的起点不是"从下面浮上来"，而是**从环上那 12 张刚才所在的位置
   * 飞回来**（几何与三块分工写在 `lib/theme-handoff.ts` 文件头）。
   *
   * ★ 只读**不认领**（`peekThemes` 而不是"拿走"）：React 严格模式会重复调用这个
   *   初始化器，读一次就没的写法在 dev 下会读到空的；认领交给下面那个 effect。
   * ★ 它是**一次性**的：初始化器只在挂上这一屏时跑一次，之后换个值重播整条
   *   进场时间线是错的（那是"页面刷新了"的感觉）——`useEnterTimeline` 里那个 ref
   *   把这条意思写死了。
   * ★ 没有载荷（直接访问 / 刷新 / 静止模式 / 从别的入口进来）→ `themeArrival([])`
   *   返回 null → 墙上那一步走 `ENTER_STEPS` 原来那条，**一个数都没动**。 */
  const [arrival] = useState(() => themeArrival(peekThemes() ?? []))
  useEnterTimeline(rootRef, arrival)
  /* 认领掉这一份。不清的话它会一直躺到过期，而"窗口内从别的入口进 /home"
     （去 /shelf 转一圈再回来，`staleTimes` 那 30 秒里回访是常态）会拿一份
     跟当下毫无关系的位置去飞。挂上这一屏就算用过——**这一屏只有第一次挂上是那一次接力** */
  useEffect(() => forgetThemes(), [])

  const ready = wish.trim() !== ''
  const chosen = cards.find((card) => card.cardId === picked) ?? cards[0] ?? null
  /** 已经挑好的那条主题的中文名。★ 它是 `THEMES` 里的**枚举值**，不是用户输入——
   *  优化那句话时它只作为上下文，优化器不许改它（改了就不是模板了） */
  const themeLabel = THEMES.find((item) => item.key === theme)?.label ?? ''

  /* 音色读的是 `VoiceProvider` 里那**唯一**一份，写回也是 */
  /* ★ 表来自 `VoiceProvider`（预设 + 我录的），不再直接 map `DEFAULT_VOICES`：
     自己录的那条必须也能在这里选到，而那一步要经过"模型对不上就不许选"这条判据——
     判据只在 `voiceCatalog` 里有一份（见那个文件头） */
  const voice = voices.find((item) => item.id === voiceId) ?? null
  /* ★ 原来这里还有 `speechOk` / `speechKeysReady` 两条推导，只喂给那句语音警示。
     警示按用户要求撤了，它们跟着删——留着会变成"两句没人读的判断"，
     下一个人会以为界面上还有一处地方在说这件事（现在没有，见 `.cl__bar` 那段注释） */

  /* 优化用的是**文本**那一项。★ 与"能不能出书"分开判：站里只配了图像时，
     照样能出书，但"把这句话改一改"动不了——两件事的边界不一样。
     ★ 判据是两句**不在用户手上**的事实（2026-10-17 ADR-0009 + 2026-10-18 收成一位）：
       `mayCreate` 是"站长有没有把这个人关掉"，`configured.text` 是"站里配没配文本模型"。
       而它们**要分开**：一句是"找站长要权限"，一句是"站里还没配好，等一等"。 */
  const textBlocked = !mayCreate || !configured.text
  /* ★ 跑一本书要的两件事。这里只是**体验**：真正管用的是 `/api/books` 那道 403
     （见工单 07 第 1 条）。
     ★ 两句分开写是要紧的：`mayCreate` 是"这个人行不行"，`canCreate(configured)`
     是"站里能不能画能写"——它们各自的下一步不一样（找站长 vs 等一等）。 */
  const allowed = mayCreate && canCreate(configured)
  const [gateOpen, setGateOpen] = useState(false)
  /* ★ 建议**过期了没有**。用户提出建议之后又自己改了原句，那条建议就是照着旧句写的；
     照旧摆在下面而不说，等于让他拿一句对不上的话去替换。静态提示一句比偷偷清掉好：
     清掉的话他会以为"优化失败了" */
  const suggestStale = suggest !== null && wish !== suggest.original && wish !== suggest.text

  // 弹出层：Esc 与点外面都收。两格共用这一条。与抽屉同一套习惯，不另发明一套
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null)
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (cardRef.current?.contains(target) || voiceRef.current?.contains(target)) return
      setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const submit = async (): Promise<void> => {
    if (!ready) return
    /*
     * ★ **先问"登录了没有"**（用户 2026-10-17：没有登录就去创作，出现一个弹窗
     *   显示"请登录"，点它就跳登录界面）。这一步与下面那道权限闸是两件事：
     *   没登录要他去登录，登录了没权限要他去**找站长**——两句不同的话、
     *   两个不同的下一步。合在一个弹窗里，用户就分不清该去哪。
     * ★ 这一次 `ask()` 顺带把最新的权限带回来了，所以下面不必再问一次。
     *
     * ★ 2026-10-17：它从"权限闸之前"挪到了**最前面**，越过了下面那条"没有卡就先
     *   去建卡"。原因是那条分支会 `router.push('/character/new')`——而
     *   `/character/new` 那一屏**自己不拦登录**（它只是一个壳，出形象时才调接口）。
     *   于是未登录的人点「开始创作」会被直接送进建卡表单，填完整整一张表
     *   才在保存那一步吃到 401。这正是这一段后面那句"别让人白填一遍"要防的事，
     *   而按原来的次序，偏偏它防不住。
     *   ★ 次序上仍然是**登录 → 有没有卡 → 有没有权限**：前一步是后一步的前提，
     *     而"去登录"这一屏对未登录的人来说才是真正能解决他那件事的那一屏。
     */
    const verdict = await gate.ask()
    if (verdict.kind === 'signed-out') {
      setOpen(null)
      return
    }
    /* ★ 没有卡就先去建卡。创作流从这一轮起**不再有第 1 步**（孩子在主页上就定了），
       所以带着一句没有卡的话进去，创作流那边没有任何一步能补上它。
       这不是"拦住用户"，是把他送到真正能解决这件事的那一屏。
       （走到这里的人一定已经登录了——见上面那一段的次序） */
    if (!chosen) {
      router.push('/character/new')
      return
    }
    /*
     * ★ 权限闸（用户 2026-10-16 的原话：点开始创作时提示"当前用户没有权限，请联系管理员"）。
     *   **就地**显示，不打开尺寸弹窗——让人先答完"要几页、要不要朗读"再被告知
     *   "你根本做不了"，是一种白问。判据是**文本 + 图像**（跑一本书最少要的两件事）。
     *
     * ★ 这是三道闸里**最不管用**的那道（服务端那条 403 才是规则）：界面上的判断
     *   既可以过期、也可以被绕过。它的价值只在于"别让人白填一遍"。
     *   所以它在这里**如实说缺什么、怎么找人**，而不是做一个看着像拦住了的样子。
     */

    /*
     * ★ 判权限用的是**刚才那一刻**问回来的那一份，不是渲染时那一份。
     *   站长在管理页把某个人的权限收回去时，这个人这一屏上的 `allowed` 还是旧的
     *   （`AuthProvider` 只在挂载时问一次）——而"点开始创作时提示没有权限"
     *   说的正是**此刻**。
     */
    const live = verdict.allowed && canCreate(verdict.configured)
    if (!live) {
      setGateOpen(true)
      setOpen(null)
      return
    }
    // 有权限了：把上一次留下的提示收掉（不然它会一直挂在那里，像一句还没解决的问题）
    setGateOpen(false)
    /* ★ 点「开始创作」不再直接跳走，先问"这一本要怎么做"（工单 04）。
       页数与"要不要朗读"都必须在**跑之前**定下来——跑起来再问等于让人等两次。
       确认之后才带着这两个数去 `/create`（运行视图）。 */
    setSetupOpen(true)
    // 那两格下拉先收起来：模态浮上来之后它们还开着的画面没有意义
    setOpen(null)
  }

  /**
   * 关掉弹窗，并把焦点**还给打开它的那一颗**。
   * ★ 不还的话，Esc 之后焦点落在 `<body>` 上——读屏会从文档开头重新念一遍，
   *   而键盘用户按一次 Tab 会回到侧栏第一项。这是模态最常被漏掉的一半。
   */
  const closeSetup = (): void => {
    setSetupOpen(false)
    goRef.current?.focus()
  }

  /** 弹窗里确认了。把这一轮的参数挂到地址上交给 `/create` */
  const startRun = (choice: SetupChoice): void => {
    if (!chosen) return
    setSetupOpen(false)
    const params = new URLSearchParams({ wish: wish.trim(), pages: String(choice.pages) })
    if (theme) params.set('theme', theme)
    params.set('card', chosen.cardId)
    /* ★ `voice=off` 与"不带这个参数"是**同一件事**（这一本不配音），但写成显式的 off
       更好读——而 `/create` 那边两条都当"不配音"处理（老书签里没有这个参数） */
    params.set('voice', choice.voiceId ?? 'off')
    /* ★ 形态跟着页数一起进 URL（2026-10-18 起这一问在弹窗的第一问里，
       见 `GenerationSetupDialog` 判断 1）。
       写进地址而不是只挂在组件状态上：刷新、书签、从别处点回来都要回到同一轮
       （与 `pages` / `voice` 同一条），而 `/create` 那边是**服务端**读它 */
    params.set('form', choice.form)
    router.push(`/create?${params.toString()}`)
  }

  /** 填一句现成的话。★ 骰子与封面墙走的是同一个动作，只是选法不同：一个替你挑，一个你自己挑。
   *  主题一起换，输入卡上方站着的那个孩子**也跟着换**（`figure` 是从 `theme` 推出来的）
   *  ★ `key` 可以是 `null`（2026-10-18）：灵感池里有一半句子不带主题，点到了就要把主题
   *    **清成空**——留着上一格的主题，框里的字和站着的孩子就各说各的（那一格还会亮着，
   *    像是在说"这句话是这张卡的"）。清成空之后走默认形象，与"还没挑过主题"同一条路。 */
  const applyWish = (text: string, key: ThemeKey | null): void => {
    setWish(text)
    setTheme(key)
  }

  /** 用建议：把框里的字换成建议那一句。★ 原句没丢——就在 `suggest.original` 里 */
  const useSuggestion = (): void => {
    if (!suggest) return
    setWish(suggest.text)
    setApplied(true)
  }

  /** 退回原句。★ 这才是真的撤销：退回去的是**提出建议时框里那一句**，不是"再优化一次" */
  const undoSuggestion = (): void => {
    if (!suggest) return
    setWish(suggest.original)
    setApplied(false)
  }

  /**
   * 「换一句」：从灵感池里发一张牌。
   *
   * ★ 它读的是**池子**（`INSPIRATION_POOL`，72 条），不是主题墙那 12 句——
   *   墙上那 12 句是"这一格点了填什么"，一格一句、还要配得上那张插画，
   *   所以它不可能大起来，也就不可能随机得起来（2026-10-18 用户的判断，
   *   详见 `lib/creation/inspirations.ts` 文件头）。
   * ★ 池子里每条**可以**带主题：带上就点亮那一格、立绘跟着换；不带就清空主题，
   *   站回默认形象。两种都走 `applyWish` 这一个动作。
   */
  const roll = (): void => {
    const next = drawInspiration(deckRef.current, lastRef.current)
    deckRef.current = next.deck
    lastRef.current = next.index
    // ★ `?? null`：池子里不带主题的写的是**空着**（`theme?: ThemeKey`），
    //   在这里归一成"没有主题"这一个值，别处（`applyWish` / `startRun`）不必再判两种空
    const item = INSPIRATION_POOL[next.index] as (typeof INSPIRATION_POOL)[number]
    applyWish(item.text, item.theme ?? null)
  }

  /**
   * 让模型把那句话改得更具体。★ **只回建议，不动框里的字**——
   * 直接覆盖是这一单最容易犯的错，用户会没法比较，也退不回去。
   */
  const optimize = async (): Promise<void> => {
    if (!ready || thinkingRef.current) return
    // ★ 文本这条路被卡住时**不报一句错就完**，而是把这句话**显示出来**（见 `gate` 那一段）。
    //   2026-10-17 之前这里是 `openSettings()`——那个抽屉已经没有了，
    //   "按下去打开某个抽屉"在界面上一个字都填不了的时候是假的
    if (textBlocked) {
      setGateOpen(true)
      return
    }
    thinkingRef.current = true
    setThinking(true)
    setOptimizeError(null)
    const original = wish.trim()
    try {
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wish: original,
          // ★ 有才传：角色的名字与主题都是**真实存在**的信息，没有就不传，
          //   不传一个空串让模型自己编一个
          ...(chosen?.label ? { childName: chosen.label } : {}),
          ...(themeLabel ? { themeLabel } : {}),
        }),
      })
      const data = (await response.json()) as {
        suggestion?: string
        tooLong?: boolean
        message?: string
      }
      if (!response.ok || !data.suggestion) {
        // ★ 失败就**说失败**，不退回原句假装优化过
        throw new Error(data.message ?? `HTTP ${response.status}`)
      }
      setSuggest({
        text: data.suggestion,
        tooLong: Boolean(data.tooLong),
        original,
      })
      setApplied(false)
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : String(err))
    } finally {
      // ★ 两个一起放开：ref 是闸门，state 是界面。只放一个的话，
      //   要么按钮永远停在"正在想…"，要么下一次点击被一个早就结束的请求挡住
      thinkingRef.current = false
      setThinking(false)
    }
  }

  return (
    <section className="cl" ref={rootRef}>
      <h1 className="cl__title">
        {/* 两笔手绘装饰：纯装饰，读屏不念（aria-hidden）。进场时被"画"出来，静止模式下直接在场 */}
        <svg className="cl__doodle cl__doodle--spark" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M14 4c1.6 6.4 4.6 9.4 11 11-6.4 1.6-9.4 4.6-11 11-1.6-6.4-4.6-9.4-11-11 6.4-1.6 9.4-4.6 11-11Z" />
          <path d="M31 24c.7 2.8 2 4.1 4.8 4.8-2.8.7-4.1 2-4.8 4.8-.7-2.8-2-4.1-4.8-4.8 2.8-.7 4.1-2 4.8-4.8Z" />
        </svg>
        今天想讲一个什么样的故事？
        <svg className="cl__doodle cl__doodle--leaf" viewBox="0 0 44 44" aria-hidden="true">
          <path d="M6 34c2-14 12-24 32-27-2 17-12 26-26 27" />
          <path d="M12 33c6-8 13-14 22-19" />
        </svg>
      </h1>

      <div className="cl__pills">
        <div className="cl__pick" ref={cardRef}>
          {cards.length > 0 ? (
            <>
              <button
                type="button"
                className="cl__pill"
                onClick={() => setOpen((prev) => (prev === 'card' ? null : 'card'))}
                aria-expanded={open === 'card'}
                aria-haspopup="listbox"
              >
                {/* 头像 240 档（实测 10 KB）。alt 留空：名字就在旁边，读屏不必再念一遍 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="cl__pill-face" src={chosen.faceUrl} alt="" width={24} height={24} />
                <span className="cl__pill-text">{chosen.label ?? chosen.childId}</span>
                <svg className="cl__pill-caret" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="m4 6.5 4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {open === 'card' && (
                <ul className="cl__options" role="listbox">
                  {cards.map((card) => (
                    <li key={card.cardId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={card.cardId === chosen?.cardId}
                        className="cl__option"
                        onClick={() => {
                          setPicked(card.cardId)
                          setOpen(null)
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="cl__pill-face"
                          src={card.faceUrl}
                          alt=""
                          width={24}
                          height={24}
                        />
                        <span className="cl__option-name">{card.label ?? card.childId}</span>
                        {/* ★ 这里原来还有一行「第 N 版 · <模型名> 画的」——
                            2026-10-16 撤了（用户："只显示照片和姓名就行"）。
                            那是**卡的历史**，做卡那一屏才需要；在这一屏，
                            "哪张卡"由头像 + 名字就说完了，而且那行字每张都一样长 */}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            /* ★ 原来是"进去第一步就是定他"——那句在第 1 步撤掉之后就不成立了，
               所以这里直接把人送过去，而不是先送进创作流再让他自己找。
               建的还是同一张卡（`/character/new` 用的是创作流第 1 步那份 `ChildFields`）。
               ★ 2026-10-18：这一支**几乎走不到了**——访客现在也拿到两张示例卡
               （`listDemoCardPicker`，见 `home/page.tsx`），而登录的人那一支
               本来就有 `withDemoCards` 垫底。留着它是因为"一张卡都没有"仍然是一种
               合法状态（比如 `public/demo/cards/` 没跟着发布），那时药丸必须
               如实说"还没有"，而**不是**渲染一颗点开是空表的下拉。 */
            <Link className="cl__pill cl__pill--new" href="/character/new">
              <span className="cl__pill-plus" aria-hidden="true">
                +
              </span>
              还没有小主角 · 先去建一个
            </Link>
          )}
        </div>

        {/* 声音那一格。★ 是**真下拉**，写的是设置里那唯一一份音色 */}
        <div className="cl__pick" ref={voiceRef}>
          <button
            type="button"
            className="cl__pill"
            onClick={() => setOpen((prev) => (prev === 'voice' ? null : 'voice'))}
            aria-expanded={open === 'voice'}
            aria-haspopup="listbox"
          >
            {/* 一只喇叭。★ 内联 SVG 而不是 emoji 🔊——与本文件头那段同一判断 */}
            <svg className="cl__pill-sound" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3.5 7.5h2.8L10 4.2v11.6l-3.7-3.3H3.5z" />
              <path
                d="M12.8 7.4a3.4 3.4 0 0 1 0 5.2M15.2 5.2a6.6 6.6 0 0 1 0 9.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {/* 没选过时**不预填**一个默认音色：那会让"我还没选"看起来像"已经选好了"。
                `''` 是 DEFAULT_SETTINGS 里真的那个值，这里就把那个值念出来 */}
            <span className="cl__pill-text">{voice?.name ?? (voiceId || '还没选声音')}</span>
            <svg className="cl__pill-caret" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="m4 6.5 4 4 4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {open === 'voice' && (
            <ul className="cl__options cl__options--voice" role="listbox">
              {voices.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === voiceId}
                    className="cl__option cl__option--voice"
                    disabled={!item.usable}
                    title={item.why}
                    onClick={() => {
                      setVoice(item.id)
                      setOpen(null)
                    }}
                  >
                    <span className="cl__option-name">{item.name}</span>
                    {/* ★ 只留调性。原来的「调性 · 机器名」里那个机器名（`longjielidou_v3.6`）
                        2026-10-16 撤了（用户划掉的）：在这个下拉里它对选购者零信息，
                        而它当年存在的理由是"对得上号，好去 `/voice` 找那一张卡"——
                        这条下拉已经不通往 `/voice` 了，那个理由跟着消失 */}
                    {/* ★ 调性这一行只有预设音色有。自己录的那条 `tone` 是**空串**，
                        所以这里什么都不画——"用你自己录的那段声音合成"那句是同义反复
                        （判据写在 `lib/voices/catalog.ts` 里） */}
                    {item.tone ? <span className="cl__option-meta">{item.tone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="cl__card">
        {/* 绕着这张纸走的一圈光。★ 两个都是**纯装饰节点**，而且都是**静态的裁剪壳**——
            真正会转的是它们各自的 `::before`（一张超大的方片）。这么拆是为了让每帧
            只发生一次 transform 合成，而不是每帧重绘那圈渐变：用户要的是"一直转"，
            那是常驻动画，账记在 `create-landing.css` 里 `.cl__beam` 那一段。
            ★ 不给它们单开 ENTER_STEP：它们是 `.cl__card` 的孩子，跟着卡片那一步
            `from({opacity, y})` 一起进场（与下面 `.cl__figure` 同一条理由）。 */}
        <span className="cl__beam" aria-hidden="true" />
        <span className="cl__beam-glow" aria-hidden="true" />

        {/* 站着的小主角。★ **全身，不切割**——所以它是卡片的**孩子**而不是兄弟：
            脚落在纸边上、人整个在纸面上方，不需要参考做法那种"卡片盖住下半身"的
            层叠戏法（那套是给切 1/4 用的，我们这一版用不上，也少一个层叠上下文的坑）。
            挂在卡片里面还顺手跟着卡片一起进场：`useEnterTimeline` 里 `.cl__card`
            那一步 `from({opacity, y})` 会带着整棵子树动，所以**不给它单开一条
            ENTER_STEP**——两处驱动同一个位移，迟早会看到人纸分离。
            ★ 不可点（CSS 里 `pointer-events: none`）：换人在侧栏底部那一颗。
            ★ `aria-hidden` + `alt=""`：装饰，读屏不念。图没到位时它什么都不画
            （与首页那几处同一机制），所以下面那 12 张是这一屏能站人的前提。 */}
        <div className="cl__figure" aria-hidden="true">
          {/* key 一换就重挂载 → CSS 那个轻入每次换人都播一次。静止模式下不播 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={figure} src={figurePath(figure)} alt="" width={256} height={384} />
        </div>

        <label className="cl__field">
          <span className="cl__sr">想讲什么故事</span>
          <textarea
            className="cl__input"
            value={wish}
            rows={2}
            placeholder="例如：朵朵抱着月亮，轻轻走过屋顶"
            onChange={(event) => setWish(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/⌘+Enter 提交：写故事的人会用回车换行，不能抢走回车
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>

        {/* 建议区。★ 它在**框下面**、在动作栏上面：这一块只属于"这句话"，不属于整张卡
            ★ `role="status"`（2026-10-18）：这一块是**按下一颗按钮之后才出现**的，
              而它出现时读屏什么都不会说——那颗按钮的可访问名只是从"正在想…"变回
              "优化提示词"，听起来就是"什么也没发生"。急了眼的用户会再点一次。
              只给那句建议（不给整块）加上，免得连两颗按钮一起被念一遍 */}
        {suggest && (
          <div className="cl__suggest">
            <p className="cl__suggest-text" role="status">
              {suggest.text}
            </p>
            {suggest.tooLong && (
              <p className="cl__suggest-note">
                比一句话该有的长度长了一点（超了 80 字），用之前可以再删几个字。
              </p>
            )}
            {suggestStale && (
              <p className="cl__suggest-note">你后来改过原句了，这一版是照着改之前那句写的。</p>
            )}
            <div className="cl__suggest-acts">
              {applied ? (
                <button type="button" className="cl__roll" onClick={undoSuggestion}>
                  退回原句
                </button>
              ) : (
                <>
                  <button type="button" className="cl__apply" onClick={useSuggestion}>
                    用这句
                  </button>
                  <button type="button" className="cl__roll" onClick={() => setSuggest(null)}>
                    不用
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ★ 两件事共用这一句"没改成"（2026-10-17 工单 16 加了音色那一件）：
            它们的下一步是同一个动作——**再点一次**。分成两个位置、两种长相的话，
            同一屏上会出现两条"出错"的样子，而它们说的是同一类事 */}
        {(optimizeError ?? voiceError) && (
          <p className="cl__warn" role="alert">
            没改成：{optimizeError ?? voiceError}
          </p>
        )}

        {/* 动作栏。★ 左边两颗是**改框里这句话**的工具，右边那颗是**离开这一屏**——
            两者不是一类动作，所以分成两组、各占一边（原来三颗挤在右边，
            主按钮和工具抢同一处视线，用户要求把工具挪到左边） */}
        <div className="cl__bar">
          <div className="cl__tools">
            {/* 优化那一颗。★ 它在**输入框下方**，不在主题那一行——
                按钮长在别处就是误导（工单 07 §一：那里写的是"挑了恐龙再优化会变成另一只恐龙"）。
                ★ 缺文本密钥时它不报错，而是把设置打开：缺的东西在哪里就把哪里打开
                ★ 2026-10-15 按用户要求**去掉可见文字、只留那枚图标**。于是有了两条必须补的：
                  ① `aria-label`——没有可见文字之后，读屏能念的就只剩它，少了就是一颗匿名按钮；
                  ② `data-busy`——"正在想…"原来靠按钮上的字说，字没了就得靠**状态**说：
                     图标呼吸 + 一圈荡出去的光晕，整颗按钮**变得更实**（不是变淡）；
                     静止模式下两条动画都停，但实心橙与那圈固定的光晕都还在
                     （所以静止态丢的只是那点动，见 CSS 那条 @media）
                ★ 2026-10-18 补第三个属性 `data-has-suggestion`：用户报"点了之后一会浅色
                  一会原色，还以为没成功"。除了把忙态从"变淡"翻成"变实"（CSS 那一段），
                  还有一件事要说：成功之后唯一的信号是框下面多出一块，而那一块会把
                  整条动作栏往下推——他按的那颗钮挪了位，视线却还在原处。
                  右上角那颗小圆点钉在原地，说"结果在这儿，还没用" */}
            <button
              type="button"
              className="cl__optimize"
              data-busy={thinking ? 'true' : 'false'}
              data-has-suggestion={suggest && !applied ? 'true' : 'false'}
              onClick={() => void optimize()}
              disabled={!ready || thinking}
              aria-label={
                thinking
                  ? '正在想…'
                  : suggest && !applied
                    ? '优化提示词（有一条改好的句子还没用）'
                    : '优化提示词'
              }
              aria-busy={thinking}
              title={
                textBlocked
                  ? `优化提示词要用文字模型——${mayCreate ? '而站里今天还没配文本模型' : '而你的账号没有权限，请联系管理员'}`
                  : ready
                    ? '优化提示词：把这句话改得更具体（先给你看，不直接替换）'
                    : '优化提示词：先写一句话'
              }
            >
              <svg className="cl__optimize-icon" viewBox="0 0 40 40" aria-hidden="true">
                <path d="M14 4c1.6 6.4 4.6 9.4 11 11-6.4 1.6-9.4 4.6-11 11-1.6-6.4-4.6-9.4-11-11 6.4-1.6 9.4-4.6 11-11Z" />
                <path d="M31 24c.7 2.8 2 4.1 4.8 4.8-2.8.7-4.1 2-4.8 4.8-.7-2.8-2-4.1-4.8-4.8 2.8-.7 4.1-2 4.8-4.8Z" />
              </svg>
            </button>
            {/* 换一句。★ 同样只留那枚骰子，可访问名靠 `aria-label`。
                ★ 它原来是一颗圆里三个点、后来补过文字标签（"读起来像随机生成一本书"），
                  现在文字又撤了——所以 `title` 里必须把话说全，图标语言一个人扛不住。
                ★ 2026-10-18 `title` 补了半句：这一颗现在还会**顺手换主题**（抽到带主题的
                  那一半时），而主题一换，输入卡上方的立绘跟着换——不说的话，用户会以为
                  "按一下骰子孩子怎么变了"是一件自己没做过的事 */}
            <button
              type="button"
              className="cl__roll"
              onClick={roll}
              aria-label="换一句"
              title="换一句灵感（填进输入框，可以照改；带主题的那句会一起换掉上面的小主角）"
            >
              <svg className="cl__roll-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="8.5" cy="8.5" r="1.4" />
                <circle cx="15.5" cy="8.5" r="1.4" />
                <circle cx="12" cy="12" r="1.4" />
                <circle cx="8.5" cy="15.5" r="1.4" />
                <circle cx="15.5" cy="15.5" r="1.4" />
              </svg>
            </button>
          </div>
          {/* ★ 这一栏里**没有**那句语音警示了（用户要求撤掉）。后果写在这里，
              别让下一个人以为是漏了：**没配语音 Key 的人在进入创作流之前
              不会被告知"这本书没有朗读"**——「还没选声音」那颗药丸只反映
              "选没选音色"，它不知道 Key 填没填。`/voice` 那一屏仍然会拦
              （那里"没配好"意味着用户专程来做的事做不成），所以这件事不是消失了，
              是**挪到了专门管它的那一屏**。要接回来就接在**上面那颗声音药丸**旁边，
              不要另起一行小字。 */}
          <button
            ref={goRef}
            type="button"
            className="cl__go"
            onClick={() => void submit()}
            disabled={!ready}
            title={!ready ? '先写一句话' : chosen ? '开始创作' : '先去建一个小主角'}
          >
            开始创作
            <svg className="cl__go-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M3.5 10h12m-4.5-4.5L15.5 10l-4.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* ── 「没有权限」这一条 ────────────────────────────────────────────
            ★ 它就**贴在动作栏下面**（不在页面顶部、也不是一个 toast）：用户刚按下的
              是这颗钮，回答就该出现在这颗钮的旁边。toast 飘在角上要人去接，
              而这一条说的是"你刚才那件事没发生"。
            ★ 只写**那一句**（用户 2026-10-17 的原话：「就显示"当前用户没有权限，
              请联系管理员"，也不用写是什么没有权限」）。写"缺：图像"看着更周到，
              实际是把站长的配置细节摊给了一个刚进门的人看，而他既改不了也不关心。
              ★ 2026-10-18：「帮助」那一格连同它的邮箱整条拆掉了，所以这一句是这句话
              唯一的出口——"联系管理员"要靠读者自己知道去哪儿找站长（README 上有）。
            ★ 唯一还分岔的一处是"你缺权限"与"站里没配好"：后者不是他的错，
              说成"你没有权限"会让他去问一件根本不由他决定的事。
            ★ 与服务端那句 `NO_PERMISSION_MESSAGE` **不是同一句**：那一句是接口回的
              一句话（要能被 curl 到、要稳定），这一句是界面上的说明，可以更长。
              两句都指向同一件事，改的时候一起看一眼。 */}
        {gateOpen && !allowed ? (
          <p className="cl__gate" role="alert">
            {mayCreate
              ? '站里今天还没配齐创作要的模型，这不是你的问题——等一等，或者联系管理员'
              : '当前用户没有权限，请联系管理员'}
          </p>
        ) : null}
      </div>

      <h2 className="cl__wallhead">或者，挑一个主题</h2>
      {/* ★ 这一面墙与首页那个环**同序**（两边都是 `THEMES` 的顺序），接力就靠这一点：
          第 i 格接的是环上第 i 张。**谁重排了这里，接力就会错位**——
          `lib/theme-handoff.ts` 的文件头写着同一条，两处互相指着。
          ★ 这一层在 CSS 里是定位元素（`position: relative; z-index: 2`），
          也是为接力：飞行时那 12 张要从输入卡**上面**过去 */}
      <ul className="cl__wall">
        {THEMES.map((t) => {
          const wish0 = ofTheme(t.key)
          /* ★ 亮着的判据是"这一格是不是当前主题"，**不再**是"框里这句话就是这一格的例句"
             （2026-10-18 随灵感池一起改）。
             旧判据在池子下会撒谎：抽到「小恐龙在泥地里踩出的脚印…」这句时主题确实是恐龙
             （立绘换了、`?theme=` 也会带上），但框里那句话不是墙上那一句，于是墙上**一格都不亮**——
             而"哪一格是当前主题"正是这一排在说的事。
             ★ 反过来也顺：用户挑完恐龙又自己改了几个字，主题没有变，那一格就该还亮着。 */
          const active = theme === t.key
          return (
            <li key={t.key}>
              <button
                type="button"
                className="cl__theme"
                data-active={active ? 'true' : 'false'}
                onClick={() => wish0 && applyWish(wish0.text, t.key)}
                title={wish0?.text ?? t.label}
              >
                {/* 320 档派生小图（实测平均 11 KB，12 张合计 132 KB）。★ 不走 ?w=：
                    静态 public/ 走不到那条通路。alt 留空：主题名就写在图下面。
                    图缺失时这里什么都不画，卡面留一块干净的相框色，文字照样读得出来
                    （与选择点、第三屏同一机制）
                    ★ **刻意不加 `loading="lazy"`**：墙的第一行在 900px 高的窗口里
                    就落在首屏（y≈613…756），对首屏内的图用 lazy 没有收益，只有风险——
                    实测过一次干净的 1440×900 加载，12 张里 11 张停在 0×0 没被触发。
                    132 KB 换来 12 格一定画得出来，这笔账很划算；LCP 也不受影响
                    （LCP 是标题那行文字，它在 DOM 里排在图片前面，且文字不阻塞于图片） */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="cl__theme-art"
                  src={themeCardPath(t.key)}
                  alt=""
                  width={320}
                  height={180}
                />
                <span className="cl__theme-label">{t.label}</span>
                <span className="cl__theme-tag">{t.tagline}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* 「这一本要怎么做」（工单 04）。★ 挂在最后、不在动作栏旁边：
          它是**整屏**的模态，与那两格下拉不是一类东西 */}
      {/* ★ 「请先登录」那个弹窗（用户 2026-10-17）。它与尺寸弹窗互斥：
          未登录时 `submit` 根本不会走到 `setSetupOpen(true)` */}
      {gate.dialog}

      {setupOpen && (
        <GenerationSetupDialog wish={wish.trim()} onCancel={closeSetup} onConfirm={startRun} />
      )}
    </section>
  )
}
