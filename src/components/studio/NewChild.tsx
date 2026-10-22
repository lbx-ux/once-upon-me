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
// 等待与判据那两张纸（第 28 刀）。三样都是多个屏幕共用的一份：
//   纸壳与三步在 `AiWaitDialog` / `WaitSteps`，说什么话在 `wait-copy.ts`，
//   那句"还在办"的节奏在 `lib/use-rotating-line.ts`
import AiWaitDialog from '@/components/studio/AiWaitDialog.tsx'
import ProblemsDialog from '@/components/studio/ProblemsDialog.tsx'
import WaitSteps from '@/components/studio/WaitSteps.tsx'
import { waitCopyOf, type WaitJob } from '@/components/studio/wait-copy.ts'
import { useRotatingLine } from '@/lib/use-rotating-line.ts'

/**
 * NewChild —— 「新建一个小主角」（工单 03 第二刀的那一屏）
 *
 * 两条路，由"有没有照片"决定，不再由用户先选一遍
 *
 * | 情况 | 请求 | 进不进未成年人图像 |
 * | --- | --- | --- |
 * | 没上传照片（默认） | `POST /api/cards`，请求体与创作流同一份 | 不进 |
 * | 上传了照片 | `POST /api/cards/photo`，并且要单独勾一次同意 | 进，且只在这条路上 |
 *
 * 2026-10-15：原来这里是一个 `mode` 状态 + 两张入口卡（"从零描述" / "用他的照片"），
 *   用户要先把自己的意图选一遍再动手。用户把两张卡划掉了，于是路改由那件事本身
 *   决定——上传区里有照片就走照片那条。副作用是好的："
 *   没上传照片时不会被要求勾同意"这条行为自动成立，不再需要一处判断。
 *
 * 上传之后读一遍照片，把八条锚点填进右栏（本轮新加的功能）
 *
 * 一次 `POST /api/cards/analyze-photo`（`FormData`，与照片那条路同一套守门）：
 * 视觉模型按八个槽位逐条描述这个孩子，回填到右栏的锚点格。
 *
 * 它不填名字、不填读音、不填年龄。 一张照片给不出"他叫什么"，
 *   而年龄是在四档里掷骰子——那三条必须由家长自己写。
 *   所以界面上的话只能是"按这张照片填好了八条锚点"，不许写成"信息都填好了"。
 * 读不出来不影响出图：那条路照旧能走（照片本来就是"第一张插画的输入"）。
 *   所以 `readNote` 与 `error` 是两个状态，读图的失败不许写进 `error`。
 *
 * 五条不显然的约定
 *
 * 1. 照片那一路，照片只是"第一张插画的输入"，不是卡里的参考图。
 *    存进卡的是模型画出来的那张插画（见 `lib/photo-card.ts` 文件头）。所以
 *    后面逐页画、逐页比对用的都是插画——"拿照片比插画"这个没量过的任务不会发生。
 * 2. 同意不再是"勾一格"，而是"按一下那颗按钮"（2026-10-16 第十刀，用户：
 *    「这个改为一个按钮『分析锚点』」）。压过四轮：三条承诺的渲染被划掉（压成一行）→
 *    括号从"只用来画形象，处理完就删"缩成"用完就删" → 整句换成"同意用这张照片分析
 *    外貌锚点、画他的第一张形象" → 连勾带句子一起换成一颗按钮。
 *    于是 `consent: 'true'` 由谁写出来的，变了：以前是那个勾的 state，现在是
 *    用户按下的那个显式动作——按「分析锚点」发分析请求、按「出他的第一张形象」
 *    发照片那条。两次都是一个明确的、只可能是有意为之的点击。
 *    服务端的判据一个字没改：`parsePhotoForm` 照旧只认字面量 `'true'`，
 *    `photoFormProblems` 照旧把没写的挡在门外（`photo-rules.ts` 那条规则没动，
 *    它的测试也没动）。改的只是"这个 true 从哪来"。
 *    ★ 代价要说清：屏幕上不再有一句读给家长的同意话。这一格从"读一遍再勾"退回
 *    "按一下就是同意"。要做回可见的同意，就在这颗按钮旁边加一行小字——那是产品决定，
 *    不在这刀里替用户做。
 * 3. 先建档案，再出形象。 顺序反过来的坏法很安静：卡建好了而档案没存上，
 *    那个孩子从此在「角色卡」里不存在，他的形象变成一张谁也归不到名下的图。
 *    反过来（有档案、没形象）是一个正常状态，界面本来就会如实显示。
 * 4. "我们做了什么"要具体。 归一化会改那张照片（转正、压平、缩放），
 *    不许写一句笼统的"已安全处理"——那种话等于没说，而家长交出来的是一张他孩子的照片。
 *    ★ 2026-10-16 第 22 刀：那一段话被用户划掉了（"这一段话就不要说了，换成锚点信息
 *      和基本信息"）。所以这条约定今天的样子是：
 *      - 服务端照旧把每一步记下来（`photo-card.ts` 的 `notes`，逐条、具体）；
 *      - 屏幕上不再念——`/api/cards/photo` 的 `processed.notes` 现在没有任何读者，
 *        `Result` 上那个字段也跟着删了（留着就是一个看着还活的死字段）；
 *      - ★ 到第 23 刀，屏幕上一句都没有了：卡片墙上那句「照照片画的，原图没留」
 *        也被用户划掉了（见 `CharacterWall.tsx` 那一段注释）。也就是说
 *        "我们怎么处理了那张照片"这件事今天在界面上不可见——这是用户连着两次
 *        划掉它换来的结果，记在这里免得下一个人以为还有一处留着。
 *      要把逐条那一段（或那句话）请回来，得连一个放它的地方一起想（详情页最顺），
 *      别塞回这一屏；"不许笼统"那条纪律仍然成立，它管的是将来任何一句。
 * 5. 校验一句都不在这里写。 孩子那三格走 `stepProblems`（与创作流同一份），
 *    照片那几格走 `photoFormProblems`（与路由同一份），锚点走引擎的 `checkAnchors`。
 *
 * 这一屏结构上左右横跳过两次，记下来免得绕回去
 *
 * | 时间 | 结构 | 为什么 |
 * | --- | --- | --- |
 * | 上午（用户："太复杂也太乱了"） | 两列 → 一列 760px；七条锚点折进 `.nc__more` | 三十来个控件挤两列，右列是七个输入框，整屏重心压成"要我改七句话" |
 * | 下午（用户："左边上传、右边填写"） | 一列 → 两栏 1080px；锚点从折叠里出来 | 分栏判据变了：现在是左图右字，不是左字右锚点。而锚点多半是系统读出来的，要能一眼核对，折起来反而不对 |
 * | 同时 | 删掉两张入口卡、照片那三条承诺、选文件那行与尺寸说明、底部"还差图像模型与它的 key" | 用户逐块划掉的。上限与判据照旧生效，只是不再提前念一遍——超了由 `photoFormProblems` 当场说；没配模型时点按钮会拿到服务端那句人话（不是静默失败） |
 * | 晚上（用户："怎么这么长啊"） | 提示与标题同行、够宽时锚点排两列、`.nc` 上限 1080 → 1200 | 全页 2093 → 1852（视口 1080 实测），一条提示、一个字段都没删 |
 * | 晚上（用户："把这个生成放到右上角，花圈的那几句话不要了" / "上传图片不要这么多话"） | 按钮进标题行右上角；判据从"常驻页脚"改成"点过之后才出现"（原来那把 `disabled` 锁死按钮，用户连点都点不了）；左栏只剩上传控件 + 一行同意 | 删掉的是常驻的一列判据与按钮下那句说明，以及左栏的两句解释。判据的内容一句没少，只是不再提前念 |
 * | 次日（用户："照片上传完之后，应该有一个预览的照片"） | 左栏那格上传框里画照片本身（`useLocalShot` 的本地地址），`＋` 只在没选时站着 | 上一刀把话删到只剩一行文件名，可那一行字认不出选的是哪张——省字省到把"看到了什么"也省掉了，这一刀补回来的是图，不是话 |
 * | 次日（用户划掉那句话："这句话不要，改为分析锚点"） | 同意那句话 → 「同意用这张照片分析外貌锚点、画他的第一张形象」 | 原来那句说的是"交出去处理这一次"，没回答这次拿它干什么；而这个勾的第一个后果就是跑 `analyzePhoto`。★ 两件事都写上：它同时是出图那条请求的门，只写"分析锚点"会让家长以为照片不会被用来画 |
 * | 次日（用户划掉整个同意框："这个改为一个按钮『分析锚点』…没有上传按钮为白色"） | 同意勾那一行 → 一颗「分析锚点」按钮（`.nc__analyze`）：没照片白底、有照片橙底；选完照片不再自动读，读由这一按发起 | 用户四次划的都是这一格；而"读锚点"本来是一件用户想主动发起的事，它之前被绑在"勾同意"上——勾一下既表示同意又顺手跑了分析，两件事挤在一个控件里 |
 * | 同日（用户："这里锚点里面的字都是灰色的…能分析的地方就变成黑色字体" / "分析锚点这个过程应该可视化一些" / "画线的那句话不要了"） | 八条锚点的初始值清空（示例文字下沉成灰色占位）；读的等待从一行字变成三步 + 已等几秒；读数那三句里的"我把那几格清空了…你补一下"删掉 | 灰＝还没定、黑＝已经有锚点，这一条分界同时把"示例值被当成锚点交上去"这个旧账销掉（照片那条路原来要专门清一次空）。等待那一段是 45 秒，那三步不是进度条，因为没有真实进度可读——推导今天在 `lib/use-rotating-line.ts` 文件头（第 28 刀搬过去的） |
 * | 同日（用户："画圈的这个话删除" / "画人物的时候没有反馈，应该也弄一个进度"） | 读照片那一段末尾那句"没有进度条可显示…"删掉；出图那几十秒也给了三步（右上角，与按钮同住） | 用户在那一句上画了圈。★ 删的是那句话不是那条判断："为什么不给百分比"的理由留在注释里。出图那条路同样是两次真请求（存档案 → 出图），所以照抄一套三步是诚实的，不是凑数 |
 * | 同日（用户："这个等待的过程不要写成已等几秒，应该写成，正在加急处理中…轮着播放" / "这一段话就不要说了，换成锚点信息和基本信息"） | 两处等待里的秒数换成轮着播的四句话（`useRotatingLine`）；结果那一屏的「我们拿你那张照片做了什么」整格换成他是谁 + 八条锚点（`.nc__sheet`） | 秒数是这一屏上唯一的真读数，换成语气句是有代价的——所以那几句话立了一条纪律：只说"还在办"，不说"办到哪儿了"（注释里写着哪几句不许说）。被划掉的那格有两件东西各有去处，见文件头第 4 条 |
 * | 2026-10-18 第 28 刀（用户："当用户输入好信息之后，出现了什么问题，应该出一个弹窗来提示用户，现在这样子有点不明显" / "现在这个 ai 分析锚点和制作人物的 ai 制作过程好不明显，用户有时候都没发现你在制作"） | 右上角那列 12.5px 的小字（判据 `.nc__problems` 与错误 `.nc__error`）→ 一张纸（`ProblemsDialog`，屏幕正中）；两处等待的三步 → 也是一张纸（`AiWaitDialog`），而收起那纸之后三步画回原地（所以 `WaitSteps` 有两个家，字一模一样） | 位置是那列小字真正的硬伤：它跟着按钮住在标题行右上角（第七刀挪的），而用户填完名字/照片/八条锚点之后视口多半停在左下——按完按钮视线根本不在那一角。★ 而"这一屏此刻唯一在发生的事"值得占屏幕正中那几十秒（读照片 ~45 s、出图 ~24 s）。★ 判据一个字都没改（还是那三套：`childProblems` / `checkAnchors` / `photoFormProblems`），改的只是它在哪儿说 |
 *
 * 这一刀之后这一屏自己不再画任何判据（`tried` 那个 state 跟着删了）：
 *   点那颗按钮 → 判据不通过就弹一张清单；通过就去干活、弹等待那张纸；
 *   干完活没成就弹第三张（失败那张）。三张纸都不是这一屏写的（各是一份共用组件），
 *   所以"同一个产品里两张纸长得不一样"这件事不会从这一屏长出来。
 *
 * 顺带修了一个同一屏自相矛盾：`fields.tsx` 的占位文字原来是「小宇」/「yǔ」，
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

/** 读照片那一步的结果。★ 与 `error` 分开：读不出来不影响出图那条路 */
type ReadNote = { tone: 'ok' | 'bad'; text: string }

/**
 * 八格都在、值全空。顺序是 `ANCHOR_SLOTS` 的声明序（与 `normalizeAnchors` 的输出一致，
 * 于是这张卡的指纹不会因为"谁先填的"而不同）。
 *
 * 缺格会让 `checkAnchors` 报「缺骨相」——所以空是"空值"，不是"没这一格"。
 */
function blankAnchors(): CharacterAnchor[] {
  return ANCHOR_SLOTS.map((slot) => ({ slot, value: '' }))
}

/**
 * 去掉句尾那一个终止符。
 *
 * 存在的理由只有一条：模型那句 `note` 自带句号（"…身体部分被截断。"），
 *   而我们把它拼进一句话的中间，于是屏幕上出现「…读不出来。。」两个句号连排
 *   （2026-10-16 第 20 刀的用户截图里就是这个）。拼句子这一侧负责把接缝弄干净。
 */
function trimPeriod(text: string): string {
  return text.trim().replace(/[。．！？!?]$/, '')
}

/**
 * 等待时轮着播的那几句话，与播的节奏都不在这一屏里（第 28 刀搬走的两样）：
 *
 * | 搬到哪儿 | 搬走的是什么 |
 * | --- | --- |
 * | `components/studio/wait-copy.ts` | 四件活各说什么（标题 / 三步 / 那几句 / 那句"收起之后它还在跑"） |
 * | `lib/use-rotating-line.ts` | 每句 8 秒这个节奏，以及"为什么只能播话、不给百分比"的推导 |
 *
 * 搬的理由是同一句话现在有两个读者：这一屏原地那一行，以及屏幕正中那张纸
 *   （弹窗被收起之后原地那一行才画出来，两处必须一模一样）。
 *   那几句的纪律（只说"还在办"，不说"办到哪儿了"）也一起搬走了，
 *   并且有了一条机器版：`wait-copy.test.ts` 断言那几句里不出现数字与百分号。
 */

/**
 * `useRotatingLine` 在"没有活在跑"的时候也得拿到一个数组。
 *
 * 写成模块常量而不是就地 `?? []`：后者每次渲染都是一个新数组，
 *   而那个 hook 的 `useEffect` 把 `lines` 放在依赖里——于是每一轮渲染都会
 *   拆掉再挂一个定时器。`active` 为 false 时它什么也不做，所以症状是"看不见的浪费"，
 *   而那种东西没人会去量。一个模块常量把这个可能直接去掉。
 */
const NO_LINES: readonly string[] = []

/**
 * 选好的那张照片本身（2026-10-16，用户："照片上传完之后，应该有一个预览的照片"）。
 *
 * 在这之前这一栏只写一行文件名（用户截图里是「【哲风壁纸】冲锋衣-吸烟 - 副本.png ·
 *   0.4 MB」）。那行字既说不出选的是谁，也认不出选错了没有——而这一栏问的正是
 *   "他的照片"，所以那张照片必须看得见。文件名留着，它是"选的是哪个文件"的凭据。
 * ★ 地址是本次会话里的对象地址（`createObjectURL`），换图或离开这一屏必须撤销：
 *   不撤销的话那个文件会被地址钉在内存里，直到标签页关掉。
 * `alt=""`：它紧挨着一行说出文件名的文字，读屏再念一遍没有信息量。
 * 非图片不画 `<img>`：`accept="image/*"` 拦不住"所有文件"，那时这一栏退回
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
     * 八条锚点从空开始（2026-10-16 第 20 刀，用户："用户进入的时候，这里锚点里面的
     * 字都是灰色的，等待模型分析出来后，能够分析的地方就变成黑色字体，不能分析出来的
     * 还是灰色字体，这样方便用户知道填什么"）。
     *
     * 以前这里填的是 `DEFAULT_ANCHORS`（小宇那一份示范），理由是"让家长知道这一格
     *   该写什么"。那段文字还在，只是换了身份：它现在是每一格的占位（灰字，
     *   见 `fields.tsx` 的 `EXAMPLE_TEXT`）——同一句示范，但它不再是这个孩子的一条锚点。
     * 换掉的理由是一条会花钱的旧账：预填值会被原样交上去。照片那条路上"读不出来的
     *   那几格"原来要专门清空一次（第 19 刀），否则卡上就是照片里的脸 + 小宇的雨鞋，
     *   而它看起来完全正常。现在那几格本来就是空的，没有可清的东西——
     *   于是那一句"我把那几格清空了（原来是小宇的示例值…）"也一起删掉了（用户划掉的）。
     * ★ 代价要说清：不传照片时，这八格得自己填（五条硬锚点不填，「出他的第一张形象」
     *   会当场报「外貌锚点：骨相是空的」）。这是这一刀新出现的约束，不是顺手改的。
     */
    return { ...start, card: { ...start.card, anchors: blankAnchors() } }
  })
  const [photo, setPhoto] = useState<File | null>(null)
  /** 那一张照片的本地预览地址（见上面的 `useLocalShot`）。★ 只用来看，不走网络 */
  const shot = useLocalShot(photo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * 按了按钮、但判据不通过 → 那张清单开着。
   *
   * 它替掉了原来的 `tried`（"点过一次"那个布尔量）。那时判据是印在按钮底下
   *   的一列小字，得先记着"他点过了"才知道要不要印；现在它是一张纸，
   *   "开着"本身就是那个状态——关掉即散，下一次按按钮重新算一遍判据
   *   （所以"改好了没有"永远由引擎那份判据回答，不是由"他点过知道了"回答）。
   */
  const [problemsOpen, setProblemsOpen] = useState(false)
  /**
   * 等待那张纸被收起了（收起 ≠ 取消，见 `AiWaitDialog.tsx` 文件头第 2 条）。
   *
   * 这个布尔量的意思是"进度现在住在原地（右上角/左栏），不在屏幕正中"——
   *   不是"没有进度了"。收起之后三步照旧画着，那一行才是它的家。
   * 每次开新的活都复位（`startWait`）：不复位的话第二次点按钮就不弹纸了。
   */
  const [waitHidden, setWaitHidden] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  /** 正在读那张照片 */
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<ReadNote | null>(null)
  /**
   * 出图那一路走到哪一步了（2026-10-16 第 21 刀）。
   * `profile` = 正在 `POST /api/children`；`image` = 档案已经存下，正在出图。
   *   只有两个值——它不是一个状态机，只是"第一个请求回来了没有"这一个事实。
   */
  const [stage, setStage] = useState<'profile' | 'image'>('profile')

  const anchors = state.card.anchors
  const patchChild = (patch: Partial<CreationState['child']>) =>
    setState((current) => ({ ...current, child: { ...current.child, ...patch } }))

  /**
   * 现在有没有一件"要等"的活在跑，是哪一件。
   *
   * 两件不可能同时在飞——两边那颗按钮都把对方算进 `disabled`（第 28 刀补的，
   *   见下面两处 `disabled`）。原来不是这样：出图那几十秒里「分析锚点」照样能按，
   *   于是两个请求同时在飞、各自花钱，而读回来的八条锚点会盖在正在出的那张图上
   *   ——那一版形象按的是旧锚点，屏幕上却是一份新锚点。这个洞是加这一张纸时
   *   顺手看见的（纸只能写一件事，"同时有两件"本来就不该存在）。
   */
  const waitJob: WaitJob | null = reading ? 'analyze' : busy ? 'draw' : null
  const waitCopy = waitJob
    ? waitCopyOf(waitJob, { stage, photoSize: photo ? megaOf(photo.size) : undefined })
    : null
  /**
   * 那句话轮着播的那一份。
   *
   * `active` 里那个 `waitHidden`：纸在屏幕正中的时候，原地那一行不画
   *   （同一时刻屏幕上只该有一列三步——两列会变成两个 `role="status"`，
   *   读屏把同一句话念两遍），所以原地那份从收起的那一刻起从第一句重新开始。
   */
  const waitLine = useRotatingLine(waitCopy?.lines ?? NO_LINES, waitCopy !== null && waitHidden)

  /**
   * 有没有照片就是那条路本身（2026-10-15）：原来是一个 `mode` 状态 + 两张入口卡，
   *   用户要先把"我要用照片"这件事选一遍。现在按钮不在了，路就由这一件事决定——
   *   上传了就走照片那条，没上传就按右边的描述从零生成。
   *   于是"没上传照片时不会被要求勾同意"这条行为自动成立：下面那份判据只在
   *   `photo !== null` 时参与。
   */
  const usePhoto = photo !== null

  // 判据来自引擎与 photo-rules，这里只负责把它们摆出来
  const childProblemsNow = childProblems(state.child)
  const anchorProblems = checkAnchors(anchors).map((problem) => `外貌锚点：${problem}`)
  const photoProblemsLocal = usePhoto
    ? photoFormProblems({
        name: state.child.name,
        ageBand: state.child.ageBand,
        childWord: childWordOf(state.child.lookTags, state.child.gender),
        anchors,
        // `File.size`：判"太大/没选"只需要一个数，不必先把文件读进内存
        photoBytes: photo?.size ?? 0,
        // 恒为 true：勾选框换成了「分析锚点」那颗按钮（第十刀），"用户做过一个显式动作"
        //   这件事由按下按钮本身表示（见头部第 2 条）。于是这一条判据在界面上不会再出现，
        //   而服务端那条判据一个字没改——它照旧只认字面量 'true'
        consent: true,
      })
    : []
  // 没有 `ready` 了：按钮不再靠它锁死（锁死就没法解释自己为什么点不动），
  //   判据改成"点过之后弹一张纸说"（第 28 刀；在那之前是右上角一列小字）

  /**
   * 开一件"要等"的活：把等待那张纸重新摆回屏幕正中（上一次可能被收起了）。
   * 只有这一处动作，两件活都调它——分开写就会出现"一件复位了、另一件没有"，
   *   那种坏在第二次点按钮时才露出来（纸不弹了），而那时谁也想不起来是这儿。
   */
  function startWait(): void {
    setWaitHidden(false)
  }

  /**
   * 读一遍照片，把八条锚点填好（新接口 `/api/cards/analyze-photo`）。
   *
   * ★ 没读到的槽位要清空，不能留着：那一格此刻的值是示例孩子的
   *   （`DEFAULT_ANCHORS` 里那句"芥黄短袖 + 深蓝短裤 + 一双红雨鞋"）。
   *   留着它的坏法是安静的——这张卡会变成"照片里的脸 + 示例里那个孩子的雨鞋"，
   *   而它看起来完全正常。清空之后 `checkAnchors` 会报「常服是空的」，
   *   于是家长当场看见那两格要自己填（这条判据是这一轮补的，见 card.ts 那段注释）。
   * ★ 填进去的是建议：文案里必须说"你可以改"，不许写成"已经认出你的孩子"。
   * 它只由那颗「分析锚点」按钮触发（第十刀）。以前是"选完文件顺手读一次、
   *   勾同意再补一次"，两次都可能跑；现在只有这一个入口，按两下就是读两遍——
   *   那是用户明确要的（改了照片想重读，本来就该能重读）。
   * 它同时是同意那件事的凭据：`consent: 'true'` 由这一按写出去（见头部第 2 条）。
   */
  async function analyzePhoto(file: File): Promise<void> {
    setReading(true)
    setReadNote(null)
    // ★ 上一轮可能被收起过：这一轮要重新把纸摆到屏幕正中（否则第二遍读的时候
    //   用户只看到按钮变成「正在读…」，那正是这一刀要治的那个"没发现你在制作"）
    startWait()
    try {
      const form = new FormData()
      form.set('photo', file)
      form.set('consent', 'true')
      form.set('anchors', JSON.stringify(anchors))
      // 没有 env 这一格了（2026-10-17）：密钥由站长分配，只从服务端环境来
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
      // 报"哪几格没读出来"只用 `READ_SLOTS`（七格）：「补充」不是读出来的
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
           * ★ 三条话是三种不同的处境（2026-10-16，第 19 刀），不能合成一句：
           *   ① 七条全读到 → 说"读好了七条"，并把模型那句 note 附上（它说的是这张照片是什么）；
           *   ② 读到几条 → 说清"另外几条这张照片里读不出来"，而不是含糊的"没读出来"。
           *      用户原话是「有时候用户上传的图片并不是完整的照片，可能只有是上半身，
           *      ai能识别出来什么就在锚点里填上，识别不出来的就空出来，提示用户去填」——
           *      半身照的头身比不是故障，是这张照片不含这个信息，所以那句话要让家长
           *      看出来"空着是对的"，而不是"这个功能坏了"。
           *   ③ 一条都没读到 → 这不是"这张照片有一部分看不到"，是这一次读数整个没用。
           *      原来它会走 ② 那句，读起来像"读到了一些、只是少几条"，而屏幕上其实一个空表。
           *      这一档要给出下一步（换一张 / 自己填），tone 也要是 bad。
           */
          read.size === 0
            ? '这张照片一条锚点也没读出来。换一张更清楚的（能看清脸的那种）再试一次，或者直接在右边自己填——锚点填了就能画。'
            : missing.length === 0
              ? // 数的是读出来的那一档（七条），不是八个槽位：`READ_SLOTS` 不含「补充」，
                //   而那一格本来就留给家长。写成"填好了八条"会让家长以为补充那格被填过。
                `按这张照片读好了七条锚点和外貌标签${
                  payload.note ? `（${trimPeriod(payload.note)}）` : ''
                }——都是建议，你可以改；「补充」那一格留给你自己加。`
              : /**
                 * 这一句原来还有后半截：「…我把那几格清空了（原来是小宇的示例值，
                 *   留着会画成别人），你补一下。」——2026-10-16 第 20 刀，用户在那半句上
                 *   画了线（"画线的那句话不要了"）。删它是对的，不只是因为它长：
                 *   八格初始值现在是空的（见上面 `blankAnchors`），没有可清的东西，
                 *   那句话说的是一个不再发生的事。空着的那几格自己就在说明自己
                 *   （灰示例文字坐在里面），不需要再念一遍。
                 * 顺带修掉一个标点：模型那句 `note` 自带句号，拼进来之后
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
    // 与 `analyzePhoto` 同一个动作：把等待那张纸重新摆到屏幕正中（见 `startWait`）
    startWait()
    try {
      // ① 先建档案。childId 由服务端生成——它是路径的一段，不该由客户端给
      const profileResponse = await fetch('/api/children', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: state.child.name,
          nameReading: state.child.nameReading,
          ageBand: state.child.ageBand,
          // ★ 性别（第 23 刀）：`children-body.ts` 认它、`profile.ts` 存它、
          //   `childWordOf` 用它定称呼。没选就不发这个键——服务端把"对象里没有
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
      // 档案到手了 —— 这一行就是界面上"第 1 步变成已完成"的那一刻（第 21 刀）
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
    // 只有显式写 'true' 才算同意（服务端也是这么读的，见 route.ts）。
    //   第十刀之后写它的是按「出他的第一张形象」这一下——照片挂在表单上、
    //   用户按了发送，这就是那个显式动作（见头部第 2 条）
    form.set('consent', 'true')
    // 这一行是照片唯一一次离开这台设备。它进的是请求体，
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
        // 地址由服务端给（参考图的名字带内容指纹，客户端拼不出来，只能拼一个会 404 的假路径）
        imageUrl: payload.referenceUrl,
      },
    }
  }

  // 两份判据会重复说同一件事（`stepProblems` 说"名字还没填"，`photoFormProblems`
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
          {/* 原生 <img>：图经 /api/assets 出来，next/image 要另配 loader（docs/known-tradeoffs.md 那条） */}
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

        {/* ── 右上角：出图那颗按钮（2026-10-15 第七刀）────────────────────────
            ★ 用户："把这个生成放到右上角，花圈的那几句话不要了"。
              跟着删掉的是**常驻**的那串判据与按钮下那句说明（"会用你填的模型画一张
              标准像…"）——它们原来在页脚一直列着，而这一屏默认就是空表单，
              于是每次进来都先被念一遍"名字还没填、读音还没确认"。
            ★ 但"按钮为什么点不动"不能没人说：原来靠 `disabled` 一声不吭地锁住，
              锁死之后连点都点不了，用户只会以为页面坏了。按钮**不再锁死**
              （只有干活那几十秒锁），判据改成**点了之后弹一张纸**。
            ★ 2026-10-18 第 28 刀：那串判据与错误**从这一块搬走了**（原来是点过之后
              印在这儿的一列 12.5px 小字）。用户的原话是「出现了什么问题，应该出一个
              弹窗来提示用户，现在这样子有点不明显」——位置就是它真正的硬伤：
              它住在**标题行右上角**，而用户填完名字/照片/八条锚点之后视口多半停在
              左下，按完按钮视线根本不在这一角。★ 于是这一块现在只剩**按钮自己**，
              三张纸（判据/等待/失败）在屏幕正中，见下面的 `Dialog` 那一段。 */}
        <div className="nc__head-act">
          <button
            type="button"
            className="nc__btn nc__btn--primary"
            /* ★ 读照片那几十秒里也不许按（第 28 刀）：「出他的第一张形象」原来只挡
               `busy`，而读照片那 45 秒里它是能按的——两个请求同时在飞、各自花钱，
               而正在读回来的八条锚点会盖在已经发出去的那份图上。 */
            disabled={busy || reading}
            onClick={() => {
              // 判据不通过就弹清单，一个请求都不发（这是"点过之后才说"那条第七刀的
              //   约定，只是说的地方换成了屏幕正中那张纸）
              if (problems.length > 0) {
                setProblemsOpen(true)
                return
              }
              void submit()
            }}
          >
            {busy ? '正在画…' : '出他的第一张形象'}
          </button>
          {/* ── 出图那几十秒（2026-10-16 第 21 刀；第 28 刀换成一张纸）──────────
              ★ 原来这里是**按钮底下的一列三步**（`.nc__steps`）。第 28 刀把它搬进
                屏幕正中那张纸（`AiWaitDialog`），而**纸被收起之后**它画回这儿——
                所以真正要读的是"那三步是 `wait-copy.ts` 的一份文案 + `WaitSteps`
                这一个实现"，不是这十几行。
              ★ `waitHidden` 那半个条件是**屏幕整洁**的事，不是功能的事：纸在屏幕正中
                的时候原地这一列不画（同一时刻屏幕上只该有一列三步，两列会变成
                两个 `role="status"`，读屏把同一句话念两遍）。 */}
          {waitJob === 'draw' && waitHidden && waitCopy ? (
            <WaitSteps steps={waitCopy.steps} say={waitLine} />
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
                // 换图之后上一张的结论要作废（不然"读好了"那几个字会留着，
                //   而右边那八格已经是上一张读出来的）
                setReadNote(null)
              }}
            />
            {shot ? (
              /* 原生 <img> 而不是 next/image：地址是本次会话的 `blob:`，
                 next/image 的优化器只吃"它自己取得到的地址"，`blob:` 会当场变成 400
                 （要它工作得为这一格关掉优化，那还不如直接写 <img>）。
                 与 `CreateFlow.tsx` 里那几处是同一条判断，理由也写在 docs/known-tradeoffs.md。
                 eslint-disable 紧贴 <img> 那一行：写在三元外面的那一行不生效。 */
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
              ★ 2026-10-18 第 28 刀又加了 `busy`：出图那几十秒里这一颗**原来能按**，
                于是两个请求同时在飞、各自花钱，而读回来的八条锚点会盖在已经发出去的
                那份图上（那一版形象按的是旧锚点，屏幕上却是一份新锚点）。
                两件"要等"的活从这一刀起**互斥**——那张等待的纸一次只说一件事。
              ★ 这一按就是**同意**：`consent: 'true'` 由它写出去（见头部第 2 条）。 */}
          <button
            type="button"
            className="nc__btn nc__analyze"
            data-ready={usePhoto ? 'true' : 'false'}
            disabled={reading || busy}
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

          {/* ── 读照片那几十秒（2026-10-16 第 20 刀；第 28 刀换成一张纸）─────────
              ★ 用户："分析锚点这个过程应该可视化一些，分析到哪一步了"。实测一次要
                **45 秒**（`scripts/e2e-analyze-photo.mts`：45.4 s，模型先产 2400+ token
                的思考链再写正文），一行不动的字挂 45 秒，用户只会以为它卡死了。
              ★ 第 28 刀之后，这几十秒正常是**屏幕正中那张纸**在说（`AiWaitDialog`）；
                这一块只在**纸被收起**之后画出来——那时它得在原地继续说，
                否则屏幕上就没有任何东西在说"还在读"了。三步与那句话都是同一份文案
                （`wait-copy.ts`），不是两份长得像的东西。
              ★ 仍然**没有百分比**：这个请求一次性回包，中间没有任何真实进度可读
                （推导在 `lib/use-rotating-line.ts` 文件头）。★ 第 21 刀删过一句
                「这一步没有进度条可显示…」（用户："画圈的这个话删除"）——删的是那句话，
                不是那条判断：屏幕上一个字都不提进度条的事，理由留在注释里。 */}
          {waitJob === 'analyze' && waitHidden && waitCopy ? (
            <div className="nc__reading">
              <WaitSteps steps={waitCopy.steps} say={waitLine} />
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
                删了它，家长看到几个空框只会以为坏了。
                ★ 2026-10-18 第 29 刀：判据从 `usePhoto` 改成 **`readNote?.tone === 'ok'`**
                （用户："我上传照片之后，还没有开始分析锚点，系统就给出了照片里没有的
                （半身照的头身比、大头照的常服）我留空了，这些东西是等系统分析好之后
                才写的吧"）。他是对的：这句话说的是**一次读的结果**（读到了几格、哪几格
                照片里没有），而 `usePhoto` 只说明"选了一张照片"——那时一个字都还没读，
                那句话是在替一件没发生的事说话。
                ★ 判据取"读成功过"而不是"按过按钮"：读失败（`tone === 'bad'`）时那句
                「下面几格是按你那张照片读的」是假的，读失败自己那句已经说了发生什么。 */}
            {readNote?.tone === 'ok' ? (
              <p className="nc__note">
                下面几格是按你那张照片读的，<strong>读不准的直接改</strong>；
                {/* ★ 括号删了（2026-10-22，用户："括号里的内容是固定的，不符合 AI 分析的模式"）：
                    原句在「照片里没有的」后面插了「（半身照的头身比、大头照的常服）」——
                    那是**两个固定例子**，而这一句讲的是这一次读数的结果，读没读到哪一格
                    屏幕上已经用空框说清楚了，写死例子反而像在替每张照片下结论。
                    ★ 两段文字仍需贴在同一行里：JSX 把换行折成一个半角空格，
                    中文里那个缝看得见（第 19 刀用 headless 探针量到的）。 */}
                {'照片里没有的我留空了——用得着的自己补，用不着的空着也行。'}
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

      {/* ── 三张纸（2026-10-18 第 28 刀）──────────────────────────────────────
          ★ 它们写在这一屏的**末尾**（而不是按钮底下）：`Dialog` 是 `position: fixed`
            贴在屏幕正中的，文档里摆在哪儿不影响它落在哪儿。摆在末尾是为了让
            "按钮那一块"只剩按钮本身——那块地方从第七刀起已经被减过两轮了。
          ★ 三张纸**互斥**，判据分别是：清单（按了但过不去）、等待（正在干活）、
            失败（干完了没成）。同一时刻最多只有一张：前两张由 `problemsOpen` 与
            `waitJob` 决定（按清单那颗按钮时一个请求都不发，所以它俩不会重叠），
            第三张只在等待结束之后才可能开。

      ── ① 判据那张清单 ────────────────────────────────────────────────────── */}
      {problemsOpen ? (
        <ProblemsDialog
          title="先补这几处"
          /* 说清"补完之后干什么"：清单本身只是"你还差什么"，
             不说下一步的话，家长补完还得自己想起来刚才要按哪颗按钮 */
          lede="补完再按一次「出他的第一张形象」。"
          items={problems}
          tone="fix"
          onClose={() => setProblemsOpen(false)}
        />
      ) : null}

      {/* ── ② 正在干活那张纸（收起之后三步回到原地，见上面那两处 `waitHidden`）── */}
      {waitJob && waitCopy && !waitHidden ? (
        <AiWaitDialog
          job={waitJob}
          facts={{ stage, photoSize: photo ? megaOf(photo.size) : undefined }}
          onHide={() => setWaitHidden(true)}
        />
      ) : null}

      {/* ── ③ 干完了没成那张纸 ─────────────────────────────────────────────────
          ★ 它替掉的是右上角那行 13px 的红字（`.nc__error`）。失败是"等出来的"，
            而等的那几十秒里用户早就不在按钮旁边了——所以它要自己找上门来。
          ★ `error` 只由 `submit` 写（读照片那条路的结果与失败都留在左栏原地：
            "读到了几条、哪几格这张照片里读不出来"说的是**左边这一栏**的事，
            把一句"结果长什么样"塞进必须点掉的弹窗，只会给正常的结果加一次点击）。 */}
      {error ? (
        <ProblemsDialog
          title="这一步没成"
          items={[error]}
          tone="failed"
          onClose={() => setError(null)}
        />
      ) : null}
    </section>
  )
}
