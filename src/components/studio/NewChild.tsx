'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ANCHOR_LABELS, ANCHOR_SLOTS, READ_SLOTS } from '@/lib/engine/domain.ts'
import { checkAnchors } from '@/lib/engine/character-card/card.ts'
import type { CharacterAnchor } from '@/lib/engine/domain.ts'
import {
  childWordOf,
  initialState,
  stepProblems,
  toCardBody,
  type CreationState,
} from '@/lib/creation/state.ts'
import { megaOf, photoFormProblems } from '@/lib/photo-rules.ts'
import { AnchorFields, ChildFields } from '@/components/creation/fields.tsx'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'

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
 *    所以出图之后要把 `processed.notes` 逐条念出来。**不许写一句笼统的
 *    "已安全处理"**——那种话等于没说，而家长交出来的是一张他孩子的照片。
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
  /** 照片那条路才有：归一化对它做了什么 */
  notes: readonly string[]
}

/** 读照片那一步的结果。★ 与 `error` 分开：读不出来**不影响**出图那条路 */
type ReadNote = { tone: 'ok' | 'bad'; text: string }

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
  const { env } = useSettings()

  const [state, setState] = useState<CreationState>(() => initialState())
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
  const childProblems = stepProblems(state, 'child')
  const anchorProblems = checkAnchors(anchors).map((problem) => `外貌锚点：${problem}`)
  const photoProblemsLocal = usePhoto
    ? photoFormProblems({
        name: state.child.name,
        ageBand: state.child.ageBand,
        childWord: childWordOf(state.child.lookTags),
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
      form.set('env', JSON.stringify(env))
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
        tone: 'ok',
        text:
          missing.length === 0
            ? // ★ 数的是**读出来的**那一档（七条），不是八个槽位：`READ_SLOTS` 不含「补充」，
              //   而那一格本来就留给家长。写成"填好了八条"会让家长以为补充那格被填过。
              `按这张照片读好了七条锚点和外貌标签${
                payload.note ? `（${payload.note}）` : ''
              }——都是建议，你可以改；「补充」那一格留给你自己加。`
            : `读到了 ${read.size} 条，另外 ${missing.length} 条（${missing
                .map((slot) => ANCHOR_LABELS[slot])
                .join(
                  '、',
                )}）没读出来，我把那几格清空了：它们原来是小宇的示例值，留着会画成别人。你补一下。`,
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
    try {
      // ① 先建档案。childId 由**服务端**生成——它是路径的一段，不该由客户端给
      const profileResponse = await fetch('/api/children', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: state.child.name,
          nameReading: state.child.nameReading,
          ageBand: state.child.ageBand,
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
      body: JSON.stringify(toCardBody(current, env)),
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
        notes: [],
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
    form.set('childWord', childWordOf(state.child.lookTags))
    form.set('anchors', JSON.stringify(anchors))
    // ★ 只有显式写 'true' 才算同意（服务端也是这么读的，见 route.ts）。
    //   第十刀之后写它的是**按「出他的第一张形象」这一下**——照片挂在表单上、
    //   用户按了发送，这就是那个显式动作（见头部第 2 条）
    form.set('consent', 'true')
    form.set('env', JSON.stringify(env))
    // ★ 这一行是照片**唯一**一次离开这台设备。它进的是请求体，
    //   服务端读完就只在内存里（`lib/photo-card.ts` 文件头第 1 条）
    form.set('photo', photo)

    const response = await fetch('/api/cards/photo', { method: 'POST', body: form })
    const payload = (await response.json()) as {
      cardId?: string
      revision?: number
      referenceUrl?: string
      processed?: { notes?: string[]; width?: number; height?: number }
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
        notes: payload.processed?.notes ?? [],
      },
    }
  }

  // ★ 两份判据会**重复说同一件事**（`stepProblems` 说"名字还没填"，`photoFormProblems`
  //   也说），所以这里按内容去重。两个判据各自都对，谁也不该为了对方少说一句——
  //   它们的分工是"创作流那一步要什么"与"照片这条路要什么"，
  //   而这个界面恰好同时受两者约束（实测过一次：名字那一条印了两遍）
  const problems = [...new Set([...childProblems, ...anchorProblems, ...photoProblemsLocal])]

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
            {result.notes.length > 0 ? (
              <div className="nc__did">
                <h2 className="nc__h2">我们拿你那张照片做了什么</h2>
                <ul className="nc__notes">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
                {/* ★ 这里**没有**"你的照片已经安全删除"这种话。真实情况是：
                    原图从头到尾只在这台服务器的一次请求里待过，我们没有任何一处写过它。
                    说"已删除"会让人以为它曾经躺在某个地方——那句话是错的，见 nc__did-note */}
                <p className="nc__did-note">
                  原图<strong>从来没有被存下来</strong>——它只在这一次请求的内存里待过，
                  变成上面这张插画之后就没了。卡里存的、以后每一页要用的，都是这张插画。
                </p>
              </div>
            ) : null}
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
            分析锚点
          </button>

          {reading ? <p className="nc__photo-state">正在读这张照片…</p> : null}
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
                下面几格是按你那张照片读的，<strong>读不准的直接改</strong>；
                读不出来的格子我留空了（用得着的自己补，用不着的空着也行）。
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
