'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  AGE_BAND_LABELS,
  GENDER_LABELS,
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  READ_SLOTS,
} from '@/lib/engine/domain.ts'
import { checkAnchors } from '@/lib/engine/character-card/card.ts'
import type { CharacterAnchor } from '@/lib/engine/domain.ts'
import {
  childProblems,
  childWordOf,
  initialState,
  toCardBody,
  type CreationState,
} from '@/lib/creation/state.ts'
import { megaOf, photoFormProblems } from '@/lib/photo-rules.ts'
import { AnchorFields, ChildFields } from '@/components/creation/fields.tsx'

/**
 * NewChild —— 「新建一个小主角」（工单 03 第二刀的那一屏）
 *
 * ## 两条路，**由"有没有照片"决定**，不再由用户先选一遍
 *
 * | 情况 | 请求 | 进不进未成年人图像 |
 * | --- | --- | --- |
 * | 没上传照片（**默认**） | `POST /api/cards`，请求体与创作流同一份 | **不进** |
 * | 上传了照片 | `POST /api/cards/photo`，**并且要单独勾一次同意** | 进，且只在这条路上 |
 *
 * ★ 2026-10-15：原来这里是一个 `mode` 状态 + 两张入口卡（"从零描述" / "用他的照片"），
 *   用户要先把自己的意图选一遍再动手。用户把两张卡划掉了，于是路改由**那件事本身**
 *   决定——上传区里有照片就走照片那条。副作用是好的："
 *   没上传照片时不会被要求勾同意"这条行为自动成立，不再需要一处判断。
 *
 * ## 上传之后**读一遍照片**，把八条锚点填进右栏（本轮新加的功能）
 *
 * 一次 `POST /api/cards/analyze-photo`（`FormData`，与照片那条路同一套守门）：
 * 视觉模型按八个槽位逐条描述这个孩子，回填到右栏的锚点格。
 *
 * ★ **它不填名字、不填读音、不填年龄。** 一张照片给不出"他叫什么"，
 *   而年龄是在四档里掷骰子——那三条必须由家长自己写。
 *   所以界面上的话只能是"按这张照片填好了八条锚点"，不许写成"信息都填好了"。
 * ★ 读不出来**不影响出图**：那条路照旧能走（照片本来就是"第一张插画的输入"）。
 *   所以 `readNote` 与 `error` 是**两个**状态，读图的失败不许写进 `error`。
 *
 * ## 五条不显然的约定
 *
 * 1. **照片那一路，照片只是"第一张插画的输入"，不是卡里的参考图。**
 *    存进卡的是模型画出来的那张插画（见 `lib/photo-card.ts` 文件头）。所以
 *    后面逐页画、逐页比对用的都是插画——"拿照片比插画"这个没量过的任务不会发生。
 * 2. **同意不再是"勾一格"，而是"按一下那颗按钮"**（2026-10-16 第十刀，用户：
 *    「这个改为一个按钮『分析锚点』」）。压过四轮：三条承诺的渲染被划掉（压成一行）→
 *    括号从"只用来画形象，处理完就删"缩成"用完就删" → 整句换成"同意用这张照片分析
 *    外貌锚点、画他的第一张形象" → **连勾带句子一起换成一颗按钮**。
 *    ★ 于是 `consent: 'true'` 由谁写出来的，变了：以前是那个勾的 state，现在是
 *    **用户按下的那个显式动作**——按「分析锚点」发分析请求、按「出他的第一张形象」
 *    发照片那条。两次都是一个明确的、只可能是有意为之的点击。
 *    ★ **服务端的判据一个字没改**：`parsePhotoForm` 照旧只认字面量 `'true'`，
 *    `photoFormProblems` 照旧把没写的挡在门外（`photo-rules.ts` 那条规则没动，
 *    它的测试也没动）。改的只是"这个 true 从哪来"。
 *    ★ 代价要说清：屏幕上**不再有一句读给家长的同意话**。这一格从"读一遍再勾"退回
 *    "按一下就是同意"。要做回可见的同意，就在这颗按钮旁边加一行小字——那是产品决定，
 *    不在这刀里替用户做。
 * 3. **先建档案，再出形象。** 顺序反过来的坏法很安静：卡建好了而档案没存上，
 *    那个孩子从此在「角色卡」里不存在，他的形象变成一张谁也归不到名下的图。
 *    反过来（有档案、没形象）是一个**正常状态**，界面本来就会如实显示。
 * 4. **"我们做了什么"要具体。** 归一化会改那张照片（转正、压平、缩放），
 *    **不许写一句笼统的"已安全处理"**——那种话等于没说，而家长交出来的是一张他孩子的照片。
 *    ★ 2026-10-16 第 22 刀：**那一段话被用户划掉了**（"这一段话就不要说了，换成锚点信息
 *      和基本信息"）。所以这条约定今天的样子是：
 *      - 服务端照旧把每一步记下来（`photo-card.ts` 的 `notes`，逐条、具体）；
 *      - **屏幕上不再念**——`/api/cards/photo` 的 `processed.notes` 现在没有任何读者，
 *        `Result` 上那个字段也跟着删了（留着就是一个看着还活的死字段）；
 *      - ★ 到第 23 刀，**屏幕上一句都没有了**：卡片墙上那句「照照片画的，原图没留」
 *        也被用户划掉了（见 `CharacterWall.tsx` 那一段注释）。也就是说
 *        "我们怎么处理了那张照片"这件事今天在界面上不可见——这是用户连着两次
 *        划掉它换来的结果，记在这里免得下一个人以为还有一处留着。
 *      要把逐条那一段（或那句话）请回来，得连一个放它的地方一起想（详情页最顺），
 *      别塞回这一屏；"不许笼统"那条纪律**仍然成立**，它管的是将来任何一句。
 * 5. **校验一句都不在这里写。** 孩子那三格走 `stepProblems`（与创作流同一份），
 *    照片那几格走 `photoFormProblems`（与路由同一份），锚点走引擎的 `checkAnchors`。
 *
 * ## 这一屏结构上左右横跳过两次，记下来免得绕回去
 *
 * | 时间 | 结构 | 为什么 |
 * | --- | --- | --- |
 * | 上午（用户："太复杂也太乱了"） | 两列 → 一列 760px；七条锚点折进 `.nc__more` | 三十来个控件挤两列，右列是七个输入框，整屏重心压成"要我改七句话" |
 * | 下午（用户："左边上传、右边填写"） | 一列 → **两栏 1080px**；锚点从折叠里出来 | 分栏判据变了：现在是**左图右字**，不是左字右锚点。而锚点多半是系统读出来的，要能一眼核对，折起来反而不对 |
 * | 同时 | 删掉两张入口卡、照片那三条承诺、选文件那行与尺寸说明、底部"还差图像模型与它的 key" | 用户逐块划掉的。**上限与判据照旧生效**，只是不再提前念一遍——超了由 `photoFormProblems` 当场说；没配模型时点按钮会拿到服务端那句人话（不是静默失败） |
 * | 晚上（用户："怎么这么长啊"） | 提示与标题同行、够宽时锚点排两列、`.nc` 上限 1080 → 1200 | 全页 2093 → 1852（视口 1080 实测），一条提示、一个字段都没删 |
 * | 晚上（用户："把这个生成放到右上角，花圈的那几句话不要了" / "上传图片不要这么多话"） | 按钮进标题行**右上角**；判据从"常驻页脚"改成"**点过之后才出现**"（原来那把 `disabled` 锁死按钮，用户连点都点不了）；左栏只剩上传控件 + 一行同意 | 删掉的是**常驻的**一列判据与按钮下那句说明，以及左栏的两句解释。判据的内容一句没少，只是不再提前念 |
 * | 次日（用户："照片上传完之后，应该有一个预览的照片"） | 左栏那格上传框里**画照片本身**（`useLocalShot` 的本地地址），`＋` 只在没选时站着 | 上一刀把话删到只剩一行文件名，可那一行字**认不出选的是哪张**——省字省到把"看到了什么"也省掉了，这一刀补回来的是**图**，不是话 |
 * | 次日（用户划掉那句话："这句话不要，改为分析锚点"） | 同意那句话 → **「同意用这张照片分析外貌锚点、画他的第一张形象」** | 原来那句说的是"交出去处理这一次"，没回答**这次拿它干什么**；而这个勾的第一个后果就是跑 `analyzePhoto`。★ 两件事都写上：它同时是出图那条请求的门，只写"分析锚点"会让家长以为照片不会被用来画 |
 * | 次日（用户划掉整个同意框："这个改为一个按钮『分析锚点』…没有上传按钮为白色"） | 同意勾那一行 → **一颗「分析锚点」按钮**（`.nc__analyze`）：没照片白底、有照片橙底；**选完照片不再自动读**，读由这一按发起 | 用户四次划的都是这一格；而"读锚点"本来是一件**用户想主动发起**的事，它之前被绑在"勾同意"上——勾一下既表示同意又顺手跑了分析，两件事挤在一个控件里 |
 * | 同日（用户："这里锚点里面的字都是灰色的…能分析的地方就变成黑色字体" / "分析锚点这个过程应该可视化一些" / "画线的那句话不要了"） | 八条锚点的**初始值清空**（示例文字下沉成灰色占位）；读的等待从一行字变成**三步 + 已等几秒**；读数那三句里的"我把那几格清空了…你补一下"删掉 | 灰＝还没定、黑＝已经有锚点，这一条分界同时把"示例值被当成锚点交上去"这个旧账销掉（照片那条路原来要专门清一次空）。等待那一段是 45 秒，见 `useElapsedSeconds`——它是**三步**不是进度条，因为没有真实进度可读 |
 * | 同日（用户："画圈的这个话删除" / "画人物的时候没有反馈，应该也弄一个进度"） | 读照片那一段末尾那句"没有进度条可显示…"删掉；**出图**那几十秒也给了三步（右上角，与按钮同住） | 用户在那一句上画了圈。★ 删的是**那句话**不是那条判断："为什么不给百分比"的理由留在注释里。出图那条路同样是**两次真请求**（存档案 → 出图），所以照抄一套三步是诚实的，不是凑数 |
 * | 同日（用户："这个等待的过程不要写成已等几秒，应该写成，正在加急处理中…轮着播放" / "这一段话就不要说了，换成锚点信息和基本信息"） | 两处等待里的**秒数换成轮着播的四句话**（`useRotatingLine`）；结果那一屏的「我们拿你那张照片做了什么」整格换成**他是谁 + 八条锚点**（`.nc__sheet`） | 秒数是这一屏上唯一的真读数，换成语气句是有代价的——所以那几句话立了一条纪律：**只说"还在办"，不说"办到哪儿了"**（注释里写着哪几句不许说）。被划掉的那格有两件东西各有去处，见文件头第 4 条 |
 *
 * ★ 顺带修了一个**同一屏自相矛盾**：`fields.tsx` 的占位文字原来是「小宇」/「yǔ」，
 *   看着像已经填好的值，于是"名字格里写着小宇、下面却说你还没填名字"
 *   （用户截图里就是这个样子）。现在占位写成「比如：小宇」，那是举例，不是值。
 */

type Result = {
  childId: string
  cardId: string
  revision: number
  imageUrl: string
  /* ★ 这里原来还有一个 `notes`（照片那条路归一化做了什么）。
     2026-10-16 第 22 刀删掉：念它的那一格被用户划掉了，于是它成了一个
     **只写不读**的字段。服务器照旧算它、照旧回它（`/api/cards/photo` 的
     `processed.notes`），只是这一屏不再接——理由见文件头第 4 条。 */
}

/** 读照片那一步的结果。★ 与 `error` 分开：读不出来**不影响**出图那条路 */
type ReadNote = { tone: 'ok' | 'bad'; text: string }

/**
 * 八格都在、值全空。顺序是 `ANCHOR_SLOTS` 的声明序（与 `normalizeAnchors` 的输出一致，
 * 于是这张卡的指纹不会因为"谁先填的"而不同）。
 *
 * ★ 缺格会让 `checkAnchors` 报「缺骨相」——所以空是"空值"，不是"没这一格"。
 */
function blankAnchors(): CharacterAnchor[] {
  return ANCHOR_SLOTS.map((slot) => ({ slot, value: '' }))
}

/**
 * 去掉句尾那一个终止符。
 *
 * ★ 存在的理由只有一条：模型那句 `note` **自带句号**（"…身体部分被截断。"），
 *   而我们把它拼进一句话的中间，于是屏幕上出现「…读不出来。。」两个句号连排
 *   （2026-10-16 第 20 刀的用户截图里就是这个）。拼句子这一侧负责把接缝弄干净。
 */
function trimPeriod(text: string): string {
  return text.trim().replace(/[。．！？!?]$/, '')
}

/**
/**
 * 等待时轮着播的几句话（2026-10-16 第 22 刀，用户："这个等待的过程不要写成已等几秒，
 * 应该写成，正在加急处理中，然后你在想几句这样的话，轮着播放"）。
 *
 * ★ 它替掉的是**秒数**（第 20 刀加的"已等 N 秒"）。换掉的是一条**真的**读数，
 *   换成几句话——这件事值得写清楚，因为它是这一屏上唯一一处"不报实情"的地方：
 *   秒数说的是事实（确实等了这么久），而「正在加急处理中」是一句**语气**。
 *   所以这几句有一条纪律：**只说"还在办"，不说"办到哪儿了"**。
 *   - 可以说：加急、在画、快好了——它们不承诺任何具体的进度或时刻；
 *   - 不许说：「已经画好 80%」「还剩 10 秒」「正在检查五官」——那几句要么是编的进度，
 *     要么是在讲模型内部的状态，而我们**看不到**它（这个请求一次性回包，见下面那段）。
 * ★ 播的节奏：每句 8 秒，走完一轮从头来（`% lines.length`）。45 秒的读数大约走
 *   一轮半，24 秒的出图走三轮——不会快到像在闪，也不会慢到像卡住。
 * ★ 它进不了读屏：外面那层 `role="status"` 会在开始时念一次三步，
 *   而这句每 8 秒换一次，不 `aria-hidden` 就是每 8 秒打断一次用户。
 */
const ROTATE_MS = 8000

/** 读照片那几秒（`POST /api/cards/analyze-photo`，实测约 45 秒） */
const READ_LINES = [
  '正在加急处理中',
  '正在一格一格地看这张照片',
  '正在把看到的东西记下来',
  '快好了，再等一小会儿',
] as const

/** 出图那几十秒（`POST /api/cards` / `/api/cards/photo`，实测约 24 秒） */
const DRAW_LINES = [
  '正在加急处理中',
  '正在铺底色',
  '正在一点点上色',
  '快好了，再等一小会儿',
] as const

/**
 * 轮着播一句。
 *
 * ★ 为什么会走到"只能播话"这一步：这两个请求都是**一次性回包**（不是流式），
 *   在它返回之前浏览器这边收不到任何中间消息——不知道模型读到第几格了、
 *   也不知道它在想还是在写。所以这一屏上**不许**出现百分比进度条：
 *   那会是一条按时间编出来的假进度，而这个项目里假的东西比没有更糟（README §五）。
 * ★ `active` 变 false 时回到第一句：下一次点按钮要重新从「正在加急处理中」开始，
 *   而不是接着上一轮的中间。
 */
function useRotatingLine(lines: readonly string[], active: boolean): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      return
    }
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % lines.length)
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [active, lines])

  return lines[index] ?? lines[0] ?? ''
}

/**
 * 选好的那张照片本身（2026-10-16，用户："照片上传完之后，应该有一个预览的照片"）。
 *
 * ★ 在这之前这一栏只写一行文件名（用户截图里是「【哲风壁纸】冲锋衣-吸烟 - 副本.png ·
 *   0.4 MB」）。那行字既说不出选的是谁，也认不出选错了没有——而这一栏问的正是
 *   "他的照片"，所以那张照片必须**看得见**。文件名留着，它是"选的是哪个文件"的凭据。
 * ★ 地址是本次会话里的对象地址（`createObjectURL`），**换图或离开这一屏必须撤销**：
 *   不撤销的话那个文件会被地址钉在内存里，直到标签页关掉。
 * ★ `alt=""`：它紧挨着一行说出文件名的文字，读屏再念一遍没有信息量。
 * ★ **非图片不画 `<img>`**：`accept="image/*"` 拦不住"所有文件"，那时这一栏退回
 *   只显示文件名——留一个碎图标（或一张画不出来的图）比什么都不画更糟。
 */
function useLocalShot(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
    }
  }, [file])

  return url
}

export default function NewChild() {
  const router = useRouter()

  const [state, setState] = useState<CreationState>(() => {
    const start = initialState()
    /**
     * 八条锚点**从空开始**（2026-10-16 第 20 刀，用户："用户进入的时候，这里锚点里面的
     * 字都是灰色的，等待模型分析出来后，能够分析的地方就变成黑色字体，不能分析出来的
     * 还是灰色字体，这样方便用户知道填什么"）。
     *
     * ★ 以前这里填的是 `DEFAULT_ANCHORS`（小宇那一份示范），理由是"让家长知道这一格
     *   该写什么"。那段文字**还在**，只是换了身份：它现在是每一格的占位（灰字，
     *   见 `fields.tsx` 的 `EXAMPLE_TEXT`）——同一句示范，但它不再是**这个孩子**的一条锚点。
     * ★ 换掉的理由是一条会花钱的旧账：预填值会被原样交上去。照片那条路上"读不出来的
     *   那几格"原来要专门清空一次（第 19 刀），否则卡上就是**照片里的脸 + 小宇的雨鞋**，
     *   而它看起来完全正常。现在那几格本来就是空的，没有可清的东西——
     *   于是那一句"我把那几格清空了（原来是小宇的示例值…）"也一起删掉了（用户划掉的）。
     * ★ 代价要说清：**不传照片时，这八格得自己填**（五条硬锚点不填，「出他的第一张形象」
     *   会当场报「外貌锚点：骨相是空的」）。这是这一刀新出现的约束，不是顺手改的。
     */
    return { ...start, card: { ...start.card, anchors: blankAnchors() } }
  })
  const [photo, setPhoto] = useState<File | null>(null)
  /** 那一张照片的本地预览地址（见上面的 `useLocalShot`）。★ 只用来**看**，不走网络 */
  const shot = useLocalShot(photo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 点过一次"出他的第一张形象"。★ 判据**只在这一刻之后**才显示（见头部那一段注释） */
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  /** 正在读那张照片 */
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<ReadNote | null>(null)
  /** 读照片那几秒轮着播的那一句（见 `useRotatingLine`） */
  const waitLine = useRotatingLine(READ_LINES, reading)
  /**
   * 出图那一路走到哪一步了（2026-10-16 第 21 刀）。
   * ★ `profile` = 正在 `POST /api/children`；`image` = 档案已经存下，正在出图。
   *   只有两个值——它**不是**一个状态机，只是"第一个请求回来了没有"这一个事实。
   */
  const [stage, setStage] = useState<'profile' | 'image'>('profile')
  /** 出图那几十秒轮着播的那一句。★ 只在真正出图那一步开始播（存档案那一下不该算进来） */
  const drawLine = useRotatingLine(DRAW_LINES, busy && stage === 'image')

  const anchors = state.card.anchors
  const patchChild = (patch: Partial<CreationState['child']>) =>
    setState((current) => ({ ...current, child: { ...current.child, ...patch } }))

  /**
   * ★ **有没有照片就是那条路本身**（2026-10-15）：原来是一个 `mode` 状态 + 两张入口卡，
   *   用户要先把"我要用照片"这件事选一遍。现在按钮不在了，路就由这一件事决定——
   *   上传了就走照片那条，没上传就按右边的描述从零生成。
   *   ★ 于是"没上传照片时不会被要求勾同意"这条行为自动成立：下面那份判据只在
   *   `photo !== null` 时参与。
   */
  const usePhoto = photo !== null

  // 判据来自引擎与 photo-rules，这里只负责把它们**摆出来**
  const childProblemsNow = childProblems(state.child)
  const anchorProblems = checkAnchors(anchors).map((problem) => `外貌锚点：${problem}`)
  const photoProblemsLocal = usePhoto
    ? photoFormProblems({
        name: state.child.name,
        ageBand: state.child.ageBand,
        childWord: childWordOf(state.child.lookTags, state.child.gender),
        anchors,
        // ★ `File.size`：判"太大/没选"只需要一个数，不必先把文件读进内存
        photoBytes: photo?.size ?? 0,
        // ★ 恒为 true：勾选框换成了「分析锚点」那颗按钮（第十刀），"用户做过一个显式动作"
        //   这件事由**按下按钮**本身表示（见头部第 2 条）。于是这一条判据在界面上不会再出现，
        //   而服务端那条判据一个字没改——它照旧只认字面量 'true'
        consent: true,
      })
    : []
  // ★ 没有 `ready` 了：按钮不再靠它锁死（锁死就没法解释自己为什么点不动），
  //   判据改成"点过之后当场说"（`tried` + `problems`）

  /**
   * 读一遍照片，把八条锚点填好（新接口 `/api/cards/analyze-photo`）。
   *
   * ★ **没读到的槽位要清空**，不能留着：那一格此刻的值是**示例孩子**的
   *   （`DEFAULT_ANCHORS` 里那句"芥黄短袖 + 深蓝短裤 + 一双红雨鞋"）。
   *   留着它的坏法是安静的——这张卡会变成"照片里的脸 + 示例里那个孩子的雨鞋"，
   *   而它看起来完全正常。清空之后 `checkAnchors` 会报「常服是空的」，
   *   于是家长当场看见那两格要自己填（这条判据是这一轮补的，见 card.ts 那段注释）。
   * ★ 填进去的是**建议**：文案里必须说"你可以改"，不许写成"已经认出你的孩子"。
   * ★ 它**只由那颗「分析锚点」按钮触发**（第十刀）。以前是"选完文件顺手读一次、
   *   勾同意再补一次"，两次都可能跑；现在只有这一个入口，按两下就是读两遍——
   *   那是用户明确要的（改了照片想重读，本来就该能重读）。
   * ★ 它同时是**同意**那件事的凭据：`consent: 'true'` 由这一按写出去（见头部第 2 条）。
   */
  async function analyzePhoto(file: File): Promise<void> {
    setReading(true)
    setReadNote(null)
    try {
      const form = new FormData()
      form.set('photo', file)
      form.set('consent', 'true')
      form.set('anchors', JSON.stringify(anchors))
      // ★ 没有 env 这一格了（2026-10-17）：密钥由站长分配，只从服务端环境来
      const response = await fetch('/api/cards/analyze-photo', { method: 'POST', body: form })
      const payload = (await response.json()) as {
        anchors?: { slot: string; value: string }[]
        lookTags?: string[]
        note?: string
        message?: string
      }
      if (!response.ok) {
        setReadNote({ tone: 'bad', text: payload.message ?? '这张照片没读出来。' })
        return
      }
      const read = new Map((payload.anchors ?? []).map((item) => [item.slot, item.value]))
      // ★ 报"哪几格没读出来"只用 `READ_SLOTS`（七格）：**「补充」不是读出来的**
      //   （它是家长自己写的那一句，适配器根本不读它，见 `domain.ts` 的 `READ_SLOTS`）。
      //   用 `ANCHOR_SLOTS` 报的话，每读一次都会多一句"补充没读出来，原来是小宇的示例值"——
      //   而那一格既没人去读、预填又是空的，家长会去找一个不存在的故障。
      const missing = READ_SLOTS.filter((slot) => !read.has(slot))
      setState((current) => ({
        ...current,
        card: {
          // 按 ANCHOR_SLOTS 的声明序重排：与 `normalizeAnchors` 的输出顺序一致，
          // 于是这张卡的指纹不会因为"谁先填的"而不同
          anchors: ANCHOR_SLOTS.map((slot) => ({ slot, value: read.get(slot) ?? '' })),
        },
        child:
          (payload.lookTags ?? []).length > 0
            ? { ...current.child, lookTags: payload.lookTags ?? [] }
            : current.child,
      }))
      setReadNote({
        tone: read.size === 0 ? 'bad' : 'ok',
        text:
          /**
           * ★ 三条话是**三种不同的处境**（2026-10-16，第 19 刀），不能合成一句：
           *   ① 七条全读到 → 说"读好了七条"，并把模型那句 note 附上（它说的是这张照片是什么）；
           *   ② 读到几条 → 说清"另外几条**这张照片里读不出来**"，而不是含糊的"没读出来"。
           *      用户原话是「有时候用户上传的图片并不是完整的照片，可能只有是上半身，
           *      ai能识别出来什么就在锚点里填上，识别不出来的就空出来，提示用户去填」——
           *      半身照的头身比不是故障，是这张照片**不含**这个信息，所以那句话要让家长
           *      看出来"空着是对的"，而不是"这个功能坏了"。
           *   ③ **一条都没读到** → 这不是"这张照片有一部分看不到"，是**这一次读数整个没用**。
           *      原来它会走 ② 那句，读起来像"读到了一些、只是少几条"，而屏幕上其实一个空表。
           *      这一档要给出下一步（换一张 / 自己填），tone 也要是 bad。
           */
          read.size === 0
            ? '这张照片一条锚点也没读出来。换一张更清楚的（能看清脸的那种）再试一次，或者直接在右边自己填——锚点填了就能画。'
            : missing.length === 0
              ? // ★ 数的是**读出来的**那一档（七条），不是八个槽位：`READ_SLOTS` 不含「补充」，
                //   而那一格本来就留给家长。写成"填好了八条"会让家长以为补充那格被填过。
                `按这张照片读好了七条锚点和外貌标签${
                  payload.note ? `（${trimPeriod(payload.note)}）` : ''
                }——都是建议，你可以改；「补充」那一格留给你自己加。`
              : /**
                 * ★ 这一句原来还有后半截：「…我把那几格清空了（原来是小宇的示例值，
                 *   留着会画成别人），你补一下。」——2026-10-16 第 20 刀，用户在那半句上
                 *   画了线（"画线的那句话不要了"）。删它是**对的**，不只是因为它长：
                 *   八格初始值现在是空的（见上面 `blankAnchors`），**没有可清的东西**，
                 *   那句话说的是一个不再发生的事。空着的那几格自己就在说明自己
                 *   （灰示例文字坐在里面），不需要再念一遍。
                 * ★ 顺带修掉一个标点：模型那句 `note` 自带句号，拼进来之后
                 *   屏幕上会出现「…读不出来。。我把…」两个句号连排。
                 */
                `读到了 ${read.size} 条；另外 ${missing.length} 条（${missing
                  .map((slot) => ANCHOR_LABELS[slot])
                  .join('、')}）这张照片里读不出来${
                  // 模型那句 note 说的正是"这张照片是什么、缺了什么"（提示词里要求的），
                  // 所以它该出现在"哪几格空着"这一句旁边，而不是只在全读到那一档里
                  payload.note ? `——${trimPeriod(payload.note)}` : ''
                }。`,
      })
    } catch {
      setReadNote({ tone: 'bad', text: '网络断了，这张照片没读出来。' })
    } finally {
      setReading(false)
    }
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    // ★ 每按一次都从第一步起（第 21 刀）：上一轮停在哪一步不能带到这一轮
    setStage('profile')
    try {
      // ① 先建档案。childId 由**服务端**生成——它是路径的一段，不该由客户端给
      const profileResponse = await fetch('/api/children', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: state.child.name,
          nameReading: state.child.nameReading,
          ageBand: state.child.ageBand,
          // ★ 性别（第 23 刀）：`children-body.ts` 认它、`profile.ts` 存它、
          //   `childWordOf` 用它定称呼。**没选就不发这个键**——服务端把"对象里没有
          //   这一栏"与"这一栏是空串"分开看（`isGender` 只认 boy/girl）
          ...(state.child.gender ? { gender: state.child.gender } : {}),
          lookTags: state.child.lookTags,
          interestTags: state.child.interestTags,
        }),
      })
      const profilePayload = (await profileResponse.json()) as {
        childId?: string
        message?: string
      }
      if (!profileResponse.ok || !profilePayload.childId) {
        setError(profilePayload.message ?? '档案没存下来')
        return
      }
      const childId = profilePayload.childId
      // ★ 档案到手了 —— 这一行就是界面上"第 1 步变成已完成"的那一刻（第 21 刀）
      setStage('image')

      // ② 再出形象。两条路的分叉只在这里
      const made = usePhoto
        ? await submitPhoto(childId)
        : await submitDescribe({ ...state, child: { ...state.child, childId } }, childId)

      if (!made.ok) {
        // ★ 档案已经存下了。这句话要说清楚，否则家长会以为"白填了一遍"
        setError(`${made.message}（他的档案已经存下了，去「角色卡」能看到，只是还没有形象。）`)
        return
      }
      setResult(made.result)
      // 列表页要能看到这个新孩子（服务端渲染的那一屏不会自己知道）
      router.refresh()
    } catch {
      setError('网络断了。档案可能没存下——去「角色卡」看一眼再决定要不要重填。')
    } finally {
      setBusy(false)
    }
  }

  async function submitDescribe(
    current: CreationState,
    childId: string,
  ): Promise<{ ok: true; result: Result } | { ok: false; message: string }> {
    const response = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toCardBody(current)),
    })
    const payload = (await response.json()) as {
      cardId?: string
      revision?: number
      referenceUrl?: string
      message?: string
    }
    if (!response.ok || !payload.cardId || !payload.referenceUrl) {
      return { ok: false, message: payload.message ?? '形象没画出来' }
    }
    return {
      ok: true,
      result: {
        childId,
        cardId: payload.cardId,
        revision: payload.revision ?? 1,
        imageUrl: payload.referenceUrl,
      },
    }
  }

  async function submitPhoto(
    childId: string,
  ): Promise<{ ok: true; result: Result } | { ok: false; message: string }> {
    if (!photo) return { ok: false, message: '没有选照片' }

    const form = new FormData()
    form.set('childId', childId)
    form.set('name', state.child.name)
    form.set('ageBand', state.child.ageBand)
    form.set('childWord', childWordOf(state.child.lookTags, state.child.gender))
    form.set('anchors', JSON.stringify(anchors))
    // ★ 只有显式写 'true' 才算同意（服务端也是这么读的，见 route.ts）。
    //   第十刀之后写它的是**按「出他的第一张形象」这一下**——照片挂在表单上、
    //   用户按了发送，这就是那个显式动作（见头部第 2 条）
    form.set('consent', 'true')
    // ★ 这一行是照片**唯一**一次离开这台设备。它进的是请求体，
    //   服务端读完就只在内存里（`lib/photo-card.ts` 文件头第 1 条）
    form.set('photo', photo)

    const response = await fetch('/api/cards/photo', { method: 'POST', body: form })
    const payload = (await response.json()) as {
      cardId?: string
      revision?: number
      referenceUrl?: string
      message?: string
    }
    if (!response.ok || !payload.cardId || !payload.referenceUrl) {
      return { ok: false, message: payload.message ?? '照着照片没画出来' }
    }
    return {
      ok: true,
      result: {
        childId,
        cardId: payload.cardId,
        revision: payload.revision ?? 1,
        // ★ 地址由服务端给（参考图的名字带内容指纹，客户端拼不出来，只能拼一个会 404 的假路径）
        imageUrl: payload.referenceUrl,
      },
    }
  }

  // ★ 两份判据会**重复说同一件事**（`stepProblems` 说"名字还没填"，`photoFormProblems`
  //   也说），所以这里按内容去重。两个判据各自都对，谁也不该为了对方少说一句——
  //   它们的分工是"创作流那一步要什么"与"照片这条路要什么"，
  //   而这个界面恰好同时受两者约束（实测过一次：名字那一条印了两遍）
  const problems = [...new Set([...childProblemsNow, ...anchorProblems, ...photoProblemsLocal])]

  if (result) {
    return (
      <section className="nc">
        <header className="nc__head">
          <div className="nc__head-main">
            <p className="nc__eyebrow">
              <NextLink href="/character">← 角色卡</NextLink>
            </p>
            <h1 className="nc__title">{state.child.name}的形象出来了</h1>
            <p className="nc__lede">
              这是第 {result.revision} 版。它会成为后面每一页的参照物——每一页按它画，
              画完按同一批锚点核对。
            </p>
          </div>
        </header>

        <div className="nc__made">
          {/* 原生 <img>：图经 /api/assets 出来，next/image 要另配 loader（README §五 那条） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="nc__made-art" src={result.imageUrl} alt={`${state.child.name}的形象`} />
          <div className="nc__made-side">
            {/* ── 这一版卡里记着什么（2026-10-16 第 22 刀，用户："这一段话就不要说了，
                   换成锚点信息和基本信息"，划掉的是原来那一格「我们拿你那张照片做了什么」）
                ★ 划掉的那一格有两件东西，分别有去处，不是"删了就算了"：
                  ① 归一化做了哪几步（`result.notes`）——那是**这一次请求的日志**，
                     出完图它就不改变这一版卡的内容了；同一个 `processed.notes`
                     在 `ChildDetail` 的处理记录里还有一份。
                  ② 「原图从来没有被存下来」——那句隐私话当时搬去了卡片墙
                     （`.cw__photo`，第 23 刀也被用户划掉了，见 `CharacterWall.tsx`）。
                     换句话说：这一屏删掉它之后，这件事在界面上就再也没有落点。
                ★ 换上来的是这张卡**现在的样子**：他是谁 + 八条锚点。
                  判据是"这一屏说的是'他出来了'，那么紧接着该看见的是他成了什么样"，
                  而锚点是以后每一页照着画的那份依据——它比请求日志更该站在这儿。 */}
            <div className="nc__sheet">
              <h2 className="nc__h2">他是谁</h2>
              <p className="nc__meta">
                {state.child.name} · 念 {state.child.nameReading} ·{' '}
                {AGE_BAND_LABELS[state.child.ageBand]}
                {/* 性别（第 23 刀）：它是"基本信息"里的一员，而且它**就是**那个
                    决定这张脸画成男孩还是女孩的值——结果屏上说得出这一句，
                    "画偏了"的时候才有东西可核对。没选就不显示（老档案） */}
                {state.child.gender ? ` · ${GENDER_LABELS[state.child.gender]}` : ''}
              </p>
            </div>
            <div className="nc__sheet">
              <h2 className="nc__h2">外貌锚点</h2>
              <ul className="nc__facts">
                {/* ★ 按 `ANCHOR_SLOTS` 的**声明序**列，不按 state 里的顺序：
                    `anchorsWith` 是"删掉那一条再 push 到末尾"，所以改过几格的表单，
                    它的数组顺序就是**用户敲字的顺序**（实测过一次：补充跑到了第一行）。
                    表单那边一直是这么做的（`AnchorFields` 先建 Map），这里是同一条纪律。 */}
                {ANCHOR_SLOTS.map((slot) => {
                  const value = anchors.find((anchor) => anchor.slot === slot)?.value ?? ''
                  const empty = value.trim() === ''
                  return (
                    <li className="nc__fact" key={slot}>
                      <span className="nc__fact-slot">
                        {ANCHOR_LABELS[slot]}
                        <span className="nc__fact-kind">
                          {ANCHOR_STRENGTH[slot] === 'hard' ? '硬' : '软'}
                        </span>
                      </span>
                      {/* ★ 空着的照样列出来，写成「（空着）」而不是干脆不显示：
                          那是一句"以后每一页不会按它画"的实话，也是给家长的一个去处
                          （「补充」那一格本来就常年空着）。 */}
                      <span className="nc__fact-value" data-empty={empty ? 'true' : undefined}>
                        {empty ? '（空着）' : value}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
            <NextLink className="nc__btn nc__btn--primary" href={`/character/${result.childId}`}>
              去他的形象页 →
            </NextLink>
            <NextLink className="nc__btn" href="/character">
              回「角色卡」
            </NextLink>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="nc">
      <header className="nc__head">
        <div className="nc__head-main">
          <p className="nc__eyebrow">
            <NextLink href="/character">← 角色卡</NextLink>
          </p>
          <h1 className="nc__title">新建一个小主角</h1>
          <p className="nc__lede">填一次，之后每一本书都用他——同一张角色卡可以被很多本书引用。</p>
        </div>

        {/* ── 右上角：出图那颗按钮 + 它的判据（2026-10-15 第七刀）──────────────
            ★ 用户："把这个生成放到右上角，花圈的那几句话不要了"。
              跟着删掉的是**常驻**的那串判据与按钮下那句说明（"会用你填的模型画一张
              标准像…"）——它们原来在页脚一直列着，而这一屏默认就是空表单，
              于是每次进来都先被念一遍"名字还没填、读音还没确认"。
            ★ 但"按钮为什么点不动"不能没人说：原来靠 `disabled` 一声不吭地锁住，
              锁死之后连点都点不了，用户只会以为页面坏了。现在按钮**不再锁死**
              （只有出图那几秒锁），判据改成**点过之后才出现**——
              没点之前这一块一个字都没有，点了之后当场说清缺什么。
            ★ 位置也说明了一件事：这几句话是**这颗按钮的**判据，不是整页的公告。 */}
        <div className="nc__head-act">
          <button
            type="button"
            className="nc__btn nc__btn--primary"
            disabled={busy}
            onClick={() => {
              setTried(true)
              if (problems.length > 0) return
              void submit()
            }}
          >
            {busy ? '正在画…' : '出他的第一张形象'}
          </button>
          {/* ── 出图那几十秒（2026-10-16 第 21 刀，用户："画人物的时候没有反馈，
                 应该也弄一个进度"）──────────────────────────────────────────
              ★ 与读照片那一处**同一套零件**（`.nc__steps` / `nc__step` / `nc__step-say`）：
                同一屏上两段等待不该长成两种样子。位置跟着按钮走——它在这一屏的右上角，
                判据与错误也都住在这里，所以这一颗按钮的"正在干什么"也归这儿。
              ★ 三步对应**两次真的请求**加一次跳转：`POST /api/children`（存档案）→
                `POST /api/cards`（或 `/cards/photo`，出图）→ 换成结果那一屏。
                哪一步是"现在"由 `stage` 说了算——第一个请求通常一百毫秒就回来了，
                但它是**真的**一步（它失败的话这一屏要停在它上面），所以照样画出来。
              ★ 仍然**没有百分比**：出图那条请求同样是一次性回包，中间读不到进度。
                上面那行解释为什么没有进度条的那句话被用户划掉了（"这个话删除"），
                于是这里一个字都不写——理由留在这一段注释里，屏幕上是三步 + 秒数。 */}
          {busy ? (
            <ol className="nc__steps" role="status">
              <li
                className="nc__step"
                data-now={stage === 'profile' ? 'true' : undefined}
                data-done={stage === 'image' ? 'true' : undefined}
              >
                {stage === 'image' ? '档案存好了' : '正在存他的档案'}
              </li>
              <li className="nc__step" data-now={stage === 'image' ? 'true' : undefined}>
                {stage === 'image' ? '正在画他的第一张形象' : '画他的第一张形象'}
                {stage === 'image' ? (
                  <span className="nc__step-say" aria-hidden="true">
                    {drawLine}
                  </span>
                ) : null}
              </li>
              <li className="nc__step">画好了给你看</li>
            </ol>
          ) : null}
          {tried && problems.length > 0 ? (
            <ul className="nc__problems" role="status">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className="nc__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </header>

      {/* ── 两栏：左图右字（2026-10-15）────────────────────────────────────
          ★ 分栏的判据是"这一栏回答的是哪一类问题"：左边回答**他的样子从哪来**
            （一张照片，或者没有照片就按右边的描述画），右边回答**他是谁**。
            上一版的分法是"左档案 / 右锚点"——那让七格锚点成了右栏的全部内容，
            于是整屏的重心压在"要我改七句话"上。 */}
      <div className="nc__body">
        <section className="nc__photo">
          <h2 className="nc__h2">他的照片（选填）</h2>

          {/* 上传区。★ 用 `<label>` 包一个 `type=file`：点它就能选，键盘天生能用，
              不用自己拿 JS 去 `.click()` 一个藏起来的 input（那种写法的症状是
              读屏用户找不到这个控件）。★ 不做拖放：拖放要一组 dragover/drop 处理器，
              而这一屏的收益在"点了能选"；拖放记在工单的"欠着"里，不装作已经有了 */}
          <label className="nc__drop" data-chosen={photo ? 'true' : 'false'}>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                setPhoto(file)
                // ★ 换图之后上一张的结论要作废（不然"读好了"那几个字会留着，
                //   而右边那八格已经是上一张读出来的）
                setReadNote(null)
              }}
            />
            {shot ? (
              /* 原生 <img> 而不是 next/image：地址是本次会话的 `blob:`，
                 next/image 的优化器只吃"它自己取得到的地址"，`blob:` 会当场变成 400
                 （要它工作得为这一格关掉优化，那还不如直接写 <img>）。
                 与 `CreateFlow.tsx` 里那几处是同一条判断，理由也写在 README §五。
                 ★ eslint-disable 紧贴 <img> 那一行：写在三元外面的那一行不生效。 */
              // eslint-disable-next-line @next/next/no-img-element
              <img className="nc__drop-shot" src={shot} alt="" />
            ) : (
              <span className="nc__drop-plus" aria-hidden="true">
                ＋
              </span>
            )}
            <span className="nc__drop-text">
              {photo ? `${photo.name} · ${megaOf(photo.size)}` : '选一张他的照片'}
            </span>
          </label>

          {/* 2026-10-15 第七刀：这一栏只剩**一个上传控件 + 一行同意**。
              用户划掉了两句：「不传也行：按右边那几条描述生成…」（不传照片时那行）
              与"会照着这张照片画他的形象。"（传了之后那行）。
              ★ 那两句话的**内容**没有丢，只是不再念第二遍：不传照片就走右边那条路，
                这件事由"按钮上面没有照片"本身说明；传了照片走哪条路由文件名本身说明。 */}
          {photo ? (
            <p className="nc__photo-state">
              {/* 去掉之后回到"从零描述"那条路——所以这颗按钮是让"有没有照片"
                  这个分叉**可逆**的东西，不是一个装饰 */}
              <button
                type="button"
                className="nc__link"
                onClick={() => {
                  setPhoto(null)
                  setReadNote(null)
                }}
              >
                去掉这张照片
              </button>
            </p>
          ) : null}

          {/* 「分析锚点」（2026-10-16 第十刀，用户："这个改为一个按钮『分析锚点』，
              当用户上传图片之后，按钮变为橙色，用户没有上传，按钮为白色"）。
              ★ 它替掉了原来那一行同意勾。判据就是**有没有照片**（`data-ready`）：
                没照片白底、有照片橙底——橙的人在准备按下时，白的人在等第一步。
              ★ **不做成 disabled**：第七刀吃过一次亏（锁死的按钮解释不了自己为什么
                点不动），所以没照片时它照样能按，按了当场说"先选一张照片"。
              ★ 读的时候禁用（`reading`）：那是 busy，与"缺东西"不是同一件事。
              ★ 这一按就是**同意**：`consent: 'true'` 由它写出去（见头部第 2 条）。 */}
          <button
            type="button"
            className="nc__btn nc__analyze"
            data-ready={usePhoto ? 'true' : 'false'}
            disabled={reading}
            onClick={() => {
              if (!photo) {
                setReadNote({
                  tone: 'bad',
                  text: '先选一张照片，我才能读他的锚点；不打算上传就按右边那几条描述画。',
                })
                return
              }
              void analyzePhoto(photo)
            }}
          >
            {/* ★ 读的时候按钮自己也要说话（第 20 刀）：它被 `disabled` 了，
                而一颗字面不变的按钮按不动，读起来就是"按钮坏了"——
                这一颗得说清它正在干那件事 */}
            {reading ? '正在读…' : '分析锚点'}
          </button>

          {/* ── 读照片那几秒：三步 + 已等几秒（2026-10-16 第 20 刀，用户："分析锚点这个
                 过程应该可视化一些，分析到哪一步了"）─────────────────────────────
              ★ 原来这里是**一行静止的字**（"正在读这张照片…"）。实测一次要 **45 秒**
                （`scripts/e2e-analyze-photo.mts`：45.4 s，模型先产 2400+ token 的思考链
                再写正文），一行不动的字挂 45 秒，用户只会以为它卡死了。
              ★ 三步里**只有两步是事件**：照片选好了（`photo` 在手）、请求在飞（`reading`）。
                第三步是把读到的填进右栏——那是**接下来会发生的事**，写出来是因为
                用户此刻最想知道的正是"等这么久，等的是什么"。
              ★ **没有百分比**：见 `useElapsedSeconds` 上面那段——这个请求是一次性回包，
                中间没有任何真实进度可读。按时间编一条进度条，比不显示更糟。
                ★ 第 21 刀：这里原来还写过一句「这一步没有进度条可显示——模型先想完，
                  再一次性写出结果，通常 30–60 秒。」，用户把它划掉了（"画圈的这个话删除"）。
                  **删的是那句话，不是那条判断**：屏幕上从此不提"有没有进度条"这件事，
                  而"为什么不给百分比"的理由留在这段注释里，下一个人照样看得见。
              ★ 秒数那一格 `aria-hidden`：它每秒都变，进了读屏会把整句念一遍又一遍。
                外面那层 `role="status"` 负责在开始读的时候念一次。 */}
          {reading ? (
            <div className="nc__reading" role="status">
              <ol className="nc__steps">
                <li className="nc__step" data-done="true">
                  照片已选好{photo ? `（${megaOf(photo.size)}）` : ''}
                </li>
                <li className="nc__step" data-now="true">
                  模型正在读这张照片
                  <span className="nc__step-say" aria-hidden="true">
                    {waitLine}
                  </span>
                </li>
                <li className="nc__step">把读到的填进右边那几格</li>
              </ol>
            </div>
          ) : null}
          {!reading && readNote ? (
            <p className="nc__photo-state" data-tone={readNote.tone} role="status">
              {readNote.text}
            </p>
          ) : null}
        </section>

        <div className="nc__form">
          <section className="nc__sec">
            <h2 className="nc__h2">他是谁</h2>
            <ChildFields child={state.child} onPatch={patchChild} pairName />
          </section>

          {/* 八条锚点：上一版把它们折起来了（那一版是一列，收起才显得轻）；
              这一版用户明确要求"右边是填写信息，名字，读音，外貌锚点这些的"，
              而且它们现在多半是**系统读出来的**——要能一眼看见并核对，折起来反而不对。
              所以 `.nc__more` 那套折叠整块删掉了。 */}
          <section className="nc__sec">
            <h2 className="nc__h2">外貌锚点</h2>
            {/* ★ 那一整句说明删了（2026-10-16，用户在它上面画了圈："画圈的那句话不要"）。
                删掉的是两句：① 「这七条是形象唯一的判据（画的时候按它画、画完按它查）」
                ——**同一件事已经有两个地方在说**：每一格的「硬锚点/软锚点」标注、
                以及创作流第 3 步那段话；② 「没上传照片时，下面预填的是示例，照着改成他的样子」
                ——预填值本来就摆在格子里，"照着改"是看一眼就知道的事。
                ★ **留下的是有照片那一句**：它说的不是"该怎么用"，而是"这几格是哪来的"
                （读出来的、读不出来的留空了）——那是**屏幕上推不出来**的信息，
                删了它，家长看到几个空框只会以为坏了。 */}
            {usePhoto ? (
              <p className="nc__note">
                下面几格是按你那张照片读的，<strong>读不准的直接改</strong>；照片里没有的
                {/*
                  ★ 括号必须贴在同一行里（2026-10-16）：JSX 会把换行折成一个空格，
                  「照片里没有的\n（半身照的…）」在屏幕上就多出一个**半角空格**，
                  中文里那个缝看得见（第 19 刀用 headless 探针量到的）。
                */}
                {'（半身照的头身比、大头照的常服）我留空了——用得着的自己补，用不着的空着也行。'}
              </p>
            ) : null}
            {/* ★ 第六刀（用户："怎么这么长啊"）：**没有**折回去，改成宽屏排两列
                + 提示与标题同行——八条全都在，只是不再占八行。
                包一层 `.nc__anchors` 是为了让"两列"只作用在这一屏：
                `cf__card-form` 在 fields.tsx 里是个没有任何样式的钩子。 */}
            <div className="nc__anchors">
              <AnchorFields
                anchors={anchors}
                onChange={(next: CharacterAnchor[]) =>
                  setState((current) => ({ ...current, card: { ...current.card, anchors: next } }))
                }
                tight
              />
            </div>
          </section>
        </div>
      </div>

      {/* ★ 页脚整块没有了（第七刀）：判据与错误都搬到了右上角那颗按钮底下，
          按钮本身也在那儿。原来这里还有一句"会用你填的模型画一张标准像，十几秒；
          不满意可以在形象页上提建议重画，锚点不变。"——用户划掉了，**不搬**。
          （"可以在形象页上提建议重画"这条**功能**照旧在，只是不在这屏念一遍。） */}
    </section>
  )
}
