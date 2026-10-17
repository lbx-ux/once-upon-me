'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  AGE_BAND_LABELS,
  ANCHOR_LABELS,
  type AnchorSlot,
  type CharacterAnchor,
} from '@/lib/engine/domain.ts'
import type { ChildRecord } from '@/lib/engine/character-card/profile.ts'
// 表单零件与「新建小主角」那一屏共用同一份（选项与必填项只能有一处，见 fields.tsx 文件头）
import { AnchorFields, ChildFields } from '@/components/creation/fields.tsx'
// ★ 删除的确认框与凭据是**两个调用方共用**的那一份（另一个是卡片墙的 `WallDelete`）
import { DEFAULT_ANCHORS } from '@/lib/creation/default-anchors.ts'
import { toCardBody, type ChildForm } from '@/lib/creation/state.ts'
import type { CardRevisionView } from '@/lib/children-list.ts'

/**
 * ChildDetail —— 一个孩子的形象页：看、提建议再画一版、切回旧版、改基础信息、删掉他（工单 03）
 *
 * 五件不显然的事：
 *
 * 1. **"再画一版"不自动判"这条建议被采纳了吗"**，所以界面上也**不写**
 *    "AI 会尽力理解"这类免责话。理由是具体的：现有的比对器问的是"图上有没有这几条锚点"，
 *    而这次动的正是锚点管的那些部位——"眼睛再大一点"会让核对器判"眼睛不像原来那么大"，
 *    于是**成功会被判成失败**。要自动判，需要"两张图 + 一句判据"这个新的比对形态。
 *    在那之前，**新旧两版并排给家长看**就是这一版的判据，而且它不需要免责话：
 *    改没改出来，一眼就知道。
 * 2. **切回旧版不叫"撤销"，也不二次确认**。它只动 `latest` 那个指针：
 *    不删任何一版、不改任何一版，旧书仍然指着它各自那一版。叫撤销会让人
 *    以为新的一版没了，然后不敢点。
 * 3. **版本历史按时间升序读、按倒序列**：历史的理解顺序是从早到晚，
 *    而家长要找的是"刚才那一版"，所以列表最新的在最上面。
 *    ★ **示例角色的第一版不列**（2026-10-16，用户："去掉第一版，这个是系统给好的，
 *      应该直接就是好的"）。那一版不是家长的某一版，是我们**做这张卡时的草稿**：
 *      `scripts/make-demo-cards.mts` 先按锚点出一张，后来把手工出的那张叠成了第 2 版
 *      （`provenance.modelId` 写着「Google Generative AI（手工出图）」）。
 *      列出来只有坏处——它长得像"可以切回去的一个选择"，切回去的却是练习用的图。
 *      家长**自己**孩子的第一版照旧列出来：那是他真出过的一版，切回去有意义。
 *      （判据用 `demoId`，与"能不能改、能不能删"同一把尺子，见下面那段。）
 * 4. **删除的两步是"列出要失去什么"→"确认"，不是"确定吗"**（第三刀）。
 *    第二步弹的是**取回来的数字**（几本书、几版形象、每个位置各多少条），
 *    不是我们写死的一句话——因为家长需要知道的不是"你确定吗"，是"要没的是哪些"。
 *    预演与结果**共用同一个渲染组件**：两处各写一遍，就会出现
 *    "预演说删 8 条、结果说删了 7 条"这种看不出是数错了还是渲染错了的分歧。
 * 5. **「改基础信息」那一格不是"改了这一页"，改的是以后**（用户 2026-10-15 提的第 5 条）。
 *    两句实话必须印在那一格上，不然它就是在骗人：
 *    - 已经做出来的书**不变**。`book.json` 里存的是当时那份档案的**快照**，不是引用
 *      ——所以"改完名字发现书架里的旧书还写着旧名字"是**对的**，不是没生效。
 *    - 改年龄档**不会重画形象**。卡是按八条锚点画的，年龄档只在**建卡那一次**
 *      进过提示词（`ageLabelOf`）。要改他长什么样，走上面那颗「再画一版」。
 *    ★ 那一格在 `demoId` 时**不渲染**——示例孩子改不了（`PATCH` 与 `DELETE`
 *      共用同一道 `refuse()`，服务端 403）。但藏起来只是省一次白点，
 *      守卫在服务端。
 * 6. `error` / `notice` **挂在右栏顶上，不挂在某一格里**。它们是四个动作共用的那一条，
 *    而其中三个动作（切回旧版 / 改档案 / 删掉他）跟"有没有形象"没关系——
 *    写在「想改哪里」那张卡里面的话，没有形象的孩子**永远看不到失败提示**。
 */

export type ChildDetailProps = {
  profile: ChildRecord
  /** 示例角色。★ 由**来源**决定，不由档案里的字段决定（见 children-source.ts） */
  isDemo: boolean
  /**
   * 这是不是一个**随仓库发布**的示例 id（工单 03 第三刀）。
   *
   * ★ 与 `isDemo` **不是一件事**：本机可能覆盖过一份同 id 的档案，那时 `isDemo` 是
   *   false，而删除照样要拒绝——删掉覆盖的那份，露出来的还是 `public/` 里那份
   *   （`children-source.ts` 的 `isDemoChildId` 写着这条）。
   */
  demoId: boolean
  revisions: CardRevisionView[]
  anchors: readonly { slot: AnchorSlot; value: string }[]
  /**
   * ★ 2026-10-16：`checklist` 那一项**去掉了**（用户："花❌的地方不要"）——它是
   *   `checklistOf(card)` 拼给人读的那几句，只被「这张卡凭什么算同一个人」那张卡
   *   底下那段话用过；那段话与那行标题一起删了，这一项就再没有人读。
   *   引擎里的 `checklistOf` 与它喂的**比对**没动：那是"每一页还是不是他"的判据，
   *   与这一屏显示不显示一句说明无关。
   */
}

type Busy =
  | { kind: 'idle' }
  | { kind: 'revise' }
  | { kind: 'switch' }
  | { kind: 'delete' }
  | { kind: 'save' }
  /** 给一个还没有形象的孩子出**第一张**（工单 06） */
  | { kind: 'first' }

export default function ChildDetail(props: ChildDetailProps) {
  const { profile, isDemo, demoId, revisions, anchors } = props
  const router = useRouter()

  const current = revisions.find((item) => item.isCurrent) ?? null
  /**
   * 版本历史里**列出来的**那几版（见文件头第 3 条）。
   *
   * ★ 只过滤"列表"，**不动 `revisions` 本身**：`current`、图、切换动作都还按全量算——
   *   万一示例角色的 `latest` 恰好指着第 1 版（草稿），那一屏也得照常出图，
   *   不能因为"列表里没有它"就变成一片空白。
   */
  const listed = demoId ? revisions.filter((item) => item.revision > 1) : revisions

  /**
   * 头部那一行末尾那句。
   *
   * ★ **不报"第几版"了**（2026-10-16 第 24 刀，用户："不用写现在是第几版，
   *   更新完就直接就是最新的"）。
   *
   * 这一句原来在普通角色上是「 · 现在这一版是第 N 版」，而示例角色上**已经是空的**
   * ——那个编号是**我们做卡时的次序**（先按锚点出一张草稿、再把手出图叠上去），
   * 不是家长做过的一版，列表又把那些版藏掉了，说一半比不说更糊涂。
   * 这一刀把同一条道理推广到全部角色：**头部是"他是谁"那一行**
   * （年龄档、有没有形象），而版本号是一个**能切换的坐标**。
   *
   * ★ 版本号没有再别处少说一个：它照旧在**版本历史**里（`第 N 版`，
   *   选中那一行还带 `data-active`）、在图的 `alt` 里、在"从现在起用这一版"
   *   那颗按钮出现的条件里（正在看的那一版不是现在用的那一版）。
   *   那三处在**挑版本**的语境里说它，是对的；头部那句是在"介绍这个孩子"，
   *   摆一个家长需要自己跟的编号，读起来像一件待办。
   *
   * ★ 一条要如实记下的后果：点历史里的旧版"只看不动指针"时，
   *   头部不再说"你看的不是当前这一版"——那件事现在由历史列表的选中态、
   *   以及图底下那颗「从现在起用这一版」按钮说。
   */
  const versionLine = current ? '' : ' · 还没有形象'
  /** 界面在看哪一版。默认就是现在这一版；点历史里的某一版只换"看"，不动指针 */
  const [viewing, setViewing] = useState<number | null>(current?.revision ?? null)
  const [suggestion, setSuggestion] = useState('')
  const [busy, setBusy] = useState<Busy>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 「改基础信息」那一份草稿。★ `null` = 没在改。
   * 它是**从档案抄出来的一份本地草稿**，不是一条持续生效的绑定：
   * 家长改到一半不保存就离开，档案不该跟着动（那才是"改了但没点保存"最该有的行为）。
   */
  const [draft, setDraft] = useState<ChildForm | null>(null)

  /**
   * 还没有形象时，那八条锚点的草稿。★ 预填 `DEFAULT_ANCHORS`（与创作流、
   * `/character/new` 同一份中性预填），不是空表——空表会让"出一张形象"永远点不动，
   * 而家长以为自己缺了什么没填。
   */
  const [firstAnchors, setFirstAnchors] = useState<CharacterAnchor[]>([...DEFAULT_ANCHORS])

  const shown = revisions.find((item) => item.revision === viewing) ?? current

  /**
   * 给这个孩子出**第一张**形象（工单 06）。
   *
   * ★ 请求体走 `toCardBody`——与 `/character/new`、与引擎是同一份契约。
   *   在这里手拼一个 body，就是第二条迟早会漂的路径
   *   （`book-api.ts` 文件头那条：把关的代码写在组件里就只能靠手点去测）。
   * ★ 档案那几个字段从 `profile` 原样搬过来。**不重新问一遍**——
   *   名字/读音/年龄刚在上一屏填过，再填一次就是把同一件事说两遍。
   */
  async function createFirstCard(): Promise<void> {
    setBusy({ kind: 'first' })
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          toCardBody({
            child: {
              childId: profile.childId,
              name: profile.name,
              nameReading: profile.nameReading,
              ageBand: profile.ageBand,
              ...(profile.gender ? { gender: profile.gender } : {}),
              lookTags: [...profile.lookTags],
              interestTags: [...profile.interestTags],
            },
            theme: { theme: '', wish: '' },
            card: { anchors: firstAnchors },
          }),
        ),
      })
      const payload = (await response.json()) as { message?: string; revision?: number }
      if (!response.ok) {
        setError(payload.message ?? '这一张没画出来')
        return
      }
      setViewing(payload.revision ?? 1)
      setNotice('第一张形象画好了。以后做书都用它，不满意可以提建议再画一版。')
      router.refresh()
    } catch {
      setError('网络断了，这一张没画出来（可能已经计费，去平台账单看一眼）。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  async function revise(): Promise<void> {
    setBusy({ kind: 'revise' })
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/cards/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          childId: profile.childId,
          name: profile.name,
          ageBand: profile.ageBand,
          suggestion,
        }),
      })
      const payload = (await response.json()) as { message?: string; revision?: number }
      if (!response.ok) {
        setError(payload.message ?? '这一版没画出来')
        return
      }
      setSuggestion('')
      setViewing(payload.revision ?? null)
      setNotice(`第 ${payload.revision ?? '?'} 版画好了。往下看历史，上一版还在。`)
      router.refresh()
    } catch {
      setError('网络断了，这一版没画出来（可能已经计费，去平台账单看一眼）。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  async function makeCurrent(revision: number): Promise<void> {
    if (!current) return
    setBusy({ kind: 'switch' })
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/cards/latest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 卡号由服务端随版本历史一起给过来（见 CardRevisionView.cardId 的注释）
        body: JSON.stringify({ cardId: current.cardId, revision }),
      })
      const payload = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(payload.message ?? '没切过去')
        return
      }
      setNotice(`现在用的是第 ${revision} 版。以后做书都用它；已经做出来的书不受影响。`)
      router.refresh()
    } catch {
      setError('网络断了，指针没动。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  /** 从档案抄一份可改的草稿。★ `childId` 带上但**不发出去**（它只从 URL 来） */
  function draftOf(): ChildForm {
    return {
      childId: profile.childId,
      name: profile.name,
      nameReading: profile.nameReading,
      ageBand: profile.ageBand,
      // ★ 老档案没有这一栏，草稿就也是空的（`ChildForm.gender` 可选）——
      //   界面上表现为两个芯片都没亮，他重新选一次就补上了
      ...(profile.gender ? { gender: profile.gender } : {}),
      lookTags: [...profile.lookTags],
      interestTags: [...profile.interestTags],
    }
  }

  /**
   * 保存档案。
   *
   * ★ 失败时**留着草稿**：清空它等于把家长刚打的那一遍一起回滚了，
   *   而失败的原因（比如名字被引擎判空）往往正需要他改几个字再试。
   * ★ 成功后 `router.refresh()`：这一屏的标题、年龄那一行、卡墙上的名字
   *   都是服务端渲染的，不刷新就会出现"我改了但屏幕上还是旧的"。
   */
  async function saveProfile(): Promise<void> {
    if (!draft) return
    setBusy({ kind: 'save' })
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/children/${encodeURIComponent(profile.childId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          nameReading: draft.nameReading,
          ageBand: draft.ageBand,
          // ★ 性别要**每次都带上**（第 23 刀）：`PATCH` 那条路写的是整条档案，
          //   落掉这一栏就等于"改个名字把性别擦了"。没选就不发这个键
          //   （`parseChildBody` 只认字面量 boy/girl，老档案本来就没有这一栏）
          ...(draft.gender ? { gender: draft.gender } : {}),
          lookTags: draft.lookTags,
          interestTags: draft.interestTags,
        }),
      })
      const payload = (await response.json()) as { profile?: unknown; message?: string }
      if (!response.ok || !payload.profile) {
        setError(payload.message ?? '没改上')
        return
      }
      setDraft(null)
      setNotice('档案改好了。以后做的书按新的来；已经做出来的那些不变。')
      router.refresh()
    } catch {
      setError('网络断了，档案没改。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  return (
    <section className="cd">
      <header className="cd__head">
        <div>
          <p className="cd__eyebrow">
            {/* next/link 而不是 <a>：整页刷一次只为回列表，是这一屏最没必要的一笔开销 */}
            <NextLink href="/character">← 角色卡</NextLink>
          </p>
          <h1 className="cd__title">
            {profile.name}
            {profile.nameReading ? (
              <span className="cd__reading">{profile.nameReading}</span>
            ) : null}
            {isDemo ? <span className="cd__demo">示例</span> : null}
          </h1>
          <p className="cd__meta">
            {AGE_BAND_LABELS[profile.ageBand]}
            {versionLine}
          </p>
        </div>
      </header>

      <div className="cd__body">
        {/* ── 左边：形象 + 版本历史 ─────────────────────────────────────── */}
        <div className="cd__left">
          {shown ? (
            <>
              {/* 原生 <img>：图经 /api/assets 出来，next/image 要另配 loader（README §五 那条） */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="cd__art"
                src={shown.imageUrl}
                alt={`${profile.name} 第 ${shown.revision} 版的形象`}
                width={768}
                height={768}
              />
              {/* ★ 2026-10-16：图底下那行字（`第 N 版 · 模型 · 现在用它`）**删了**
                      （用户："花❌的地方不要"）。它说的两件事各有别处已经在说：
                      在看哪一版，**版本历史里选中那一行**写着（头部那句后来也删了，
                      见 `versionLine` 那段）；用的是哪个模型，本来是 `.cd__foot` 那句在说，
                      而那句用户也划掉了——一个只在这一屏出现的"是谁在画"，
                      留着就是同一件事说三遍。 */}
              {shown.suggestion ? (
                <p className="cd__art-note">这一版照着这句话改的：{shown.suggestion}</p>
              ) : null}
              {/* ★ 判据只有一条：看的那一版**不是**现在在用的那一版。这里原来多写了一个
                  `shown.revision > 1`，于是"切回第 1 版"——最常发生的那一次——
                  根本没有按钮（v1 的 revision 就是 1）。是**在浏览器里点了一遍**才发现的：
                  第 1 版看着正常，只是没有那颗按钮，静态读代码很容易看过去 */}
              {!shown.isCurrent ? (
                <button
                  type="button"
                  className="cd__btn cd__btn--ghost"
                  disabled={busy.kind !== 'idle'}
                  onClick={() => void makeCurrent(shown.revision)}
                >
                  {busy.kind === 'switch' ? '正在切…' : '从现在起用这一版'}
                </button>
              ) : null}
            </>
          ) : (
            /* ── 他还没有形象（工单 06 起，这里能自己出一张）────────────────
                   ★ 原来这里是一条通向 `/create` 第 3 步的路。2026-10-16 那条四步流程
                     整条删掉之后，**这是全站唯一一处"给一个已经存在的孩子出形象"**的地方
                     ——`/character/new` 建的是**另一个孩子**（新的 childId），
                     指向那里会造出一个重复的孩子，比没有入口更糟。
                   ★ 八条锚点用 `AnchorFields`（与新建那一屏同一份），
                     请求体走 `toCardBody`（与引擎同一份契约）。这里**一行判据都不写**：
                     不合格由 `/api/cards` 那句人话回来说。 */
            <div className="cd__empty">
              <p>这个孩子还没有形象。</p>
              <p className="cd__empty-hint">
                下面这几条决定他长什么样，会逐条成为每一页画面的依据。 写进来的一律是
                <b>跨页不变</b>的东西；姿势、表情、场景属于每一页，不写在这里。
              </p>
              <div className="cd__first">
                <AnchorFields anchors={firstAnchors} onChange={setFirstAnchors} />
                <button
                  type="button"
                  className="cd__btn"
                  disabled={busy.kind !== 'idle'}
                  onClick={() => void createFirstCard()}
                >
                  {busy.kind === 'first' ? '正在画…' : '出一张形象'}
                </button>
                <p className="cd__empty-hint">
                  一次出图十几秒。出了之后，这一屏才会长出「提建议再画一版」和版本历史。
                </p>
              </div>
            </div>
          )}

          {listed.length > 1 ? (
            <div className="cd__history">
              <h2 className="cd__h2">版本历史</h2>
              <ul className="cd__versions">
                {/* 最新的在最上面：家长要找的是"刚才那一版" */}
                {[...listed].reverse().map((item) => (
                  <li key={item.revision}>
                    <button
                      type="button"
                      className="cd__version"
                      data-active={item.revision === shown?.revision}
                      onClick={() => setViewing(item.revision)}
                    >
                      <span className="cd__version-no">第 {item.revision} 版</span>
                      {item.isCurrent ? <span className="cd__version-now">现在用它</span> : null}
                      {/* ★ 这一行的文案原来是 `item.suggestion ?? '第一版：按锚点画的'`，
                              也就是**没有建议的每一版**都会自称"第一版"——用户截图上第 2 版
                              底下就印着这句（它是脚本装进去的手工图，没有 suggestion）。
                              现在只有真的第 1 版才说这句；没有建议、又不是第一版时**什么都不写**：
                              那一版的来历我们不一定知道，"不说"比"说错"好。 */}
                      {item.suggestion ? (
                        <span className="cd__version-what">{item.suggestion}</span>
                      ) : item.revision === 1 ? (
                        <span className="cd__version-what">第一版：按锚点画的</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* ── 右边：提建议 + 这张卡凭什么算同一个人 ──────────────────────── */}
        <div className="cd__right">
          {/* ★ `error` / `notice` 是**四个动作共用的那一条**（再画一版 / 切回旧版 /
                  改档案 / 删掉他），所以它俩挂在右栏**顶上**，不挂在某一格里。
                  原来它们写在「想改哪里」那张卡里面，而那张卡被 `current` 挡着——
                  于是"这个孩子还没有形象"的那些人，删除失败与保存失败都**不显示任何话**：
                  一句"没删掉"写进了 state，却没有任何地方读它。这一条是验证时发现的，
                  不是读代码读出来的（读代码只会觉得"渲染在那儿呢"）。 */}
          {error ? (
            <p className="cd__error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p className="cd__notice">{notice}</p> : null}
          {current ? (
            <div className="cd__card">
              <h2 className="cd__h2">想改哪里？</h2>
              <p className="cd__hint">
                写下修改的建议就行，比如「眼睛再大一点，头发短一些」。它会在上一版的基础上重画一张
              </p>
              <textarea
                className="cd__textarea"
                rows={3}
                maxLength={200}
                value={suggestion}
                onChange={(event) => setSuggestion(event.target.value)}
                placeholder="眼睛再大一点，头发短一些"
                aria-label="想改哪里"
              />
              <div className="cd__row">
                <button
                  type="button"
                  className="cd__btn"
                  disabled={busy.kind !== 'idle' || suggestion.trim() === ''}
                  onClick={() => void revise()}
                >
                  {busy.kind === 'revise' ? '正在画…' : '再画一版'}
                </button>
                <span className="cd__count">{suggestion.length}/200</span>
              </div>
              {/* ★ 2026-10-16：原来这里有一句「还差图像模型与它的 key。打开模型与密钥」
                      （`!imageReady` 那一条，用户把它划掉了）。删得掉的判据与第 17 刀同一套：
                      **它不是唯一的路**——侧栏那颗「模型与密钥」一直在；而真的没配模型就点下去，
                      服务端那句话会落在右栏顶上那条 `.cd__error` 里（四个动作共用那一条），
                      不是静默失败。代价写在明处：这一屏**不再提前告诉**你"先配 key"，
                      要等点一次才知道。 */}
              {/* ★ 这里**没有**"AI 会尽力理解"这类话（文件头第 1 条）：改没改出来，
                  上面两版并排一放就知道，不需要我们用一句话先把责任推开 */}
            </div>
          ) : null}

          {/* ── 改基础信息（用户 2026-10-15 提的第 5 条）────────────────────
                  ★ 示例角色**不渲染这一格**：`PATCH` 复用的就是删除那一道 `refuse()`，
                    服务端会 403。界面上提前不给入口，比让人点完吃一句拒绝好；
                    而守卫仍然在服务端——这一格藏不藏都挡不住一个直接打接口的请求。 */}
          {demoId ? null : (
            <div className="cd__card">
              <h2 className="cd__h2">改基础信息</h2>
              {draft ? (
                <>
                  <ChildFields child={draft} onPatch={(p) => setDraft({ ...draft, ...p })} />
                  {/* ★ 两句必须说的实话，缺一句这一格就是在骗人 */}
                  <p className="cd__hint">
                    改的是<strong>以后</strong>做的书——已经做出来的那些仍然按当时那一份档案
                    （书里存的是快照，不是引用）。 年龄档改完<strong>不会重画形象</strong>
                    ：形象按那八条锚点画， 要改他长什么样，用上面那颗「再画一版」。
                  </p>
                  <div className="cd__row">
                    <button
                      type="button"
                      className="cd__btn"
                      disabled={busy.kind !== 'idle'}
                      onClick={() => void saveProfile()}
                    >
                      {busy.kind === 'save' ? '正在存…' : '保存'}
                    </button>
                    <button
                      type="button"
                      className="cd__btn cd__btn--ghost"
                      disabled={busy.kind !== 'idle'}
                      onClick={() => setDraft(null)}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="cd__hint">
                    名字、读音、年龄档，还有他喜欢什么——这些决定以后每一本里
                    <strong>故事怎么讲给他</strong>，不决定他长什么样。
                  </p>
                  <button
                    type="button"
                    className="cd__btn cd__btn--ghost"
                    disabled={busy.kind !== 'idle'}
                    onClick={() => setDraft(draftOf())}
                  >
                    改一改
                  </button>
                </>
              )}
            </div>
          )}

          {anchors.length > 0 ? (
            /* ★ 2026-10-16：这一格原来有标题（「这张卡凭什么算「同一个人」」，被用户划掉）
                   和底下一段解释（`画每一页时按这几条画…`，被用户打了两个叉）。两样都删了，
                   只留下**那八条本身**——它们是这张卡唯一不可替代的东西：
                   出图与比对都按这几条走（ADR-0007），而"为什么按这几条"是文档里的话，
                   不是家长每次打开孩子这一页要重读一遍的话。 */
            <div className="cd__card">
              <dl className="cd__anchors">
                {anchors.map((anchor) => (
                  <div key={anchor.slot} className="cd__anchor">
                    <dt>{ANCHOR_LABELS[anchor.slot]}</dt>
                    <dd>{anchor.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {/* ★ 2026-10-16：`画图用的是 <模型>。换模型在右上角的「模型与密钥」。` 这句
                  **删了**（用户："花❌的地方不要"）。删得掉的理由是核过的：它不是唯一的路——
                  侧栏那颗「模型与密钥」一直在（`AppShell`）。
                  ★ 同一天晚些时候，「再画一版」那张卡底下的「还差图像模型与它的 key」
                  也被划掉删了（第 18 刀），所以这一屏**一处都不提模型与密钥**了；
                  没配模型时点下去会吃服务端那句实话（右栏顶上那条 `.cd__error`）。 */}
        </div>
      </div>

      {/* ★ 删除（工单 03 第三刀起在这里，2026-10-16 搬走了）：
              用户把这一节划掉，理由是"删除的时候就在当前界面出现一个弹窗，询问是否删除，
              而不是还得进详情页"——于是删除**只剩卡片墙上那一处**（`WallDelete.tsx`）。
              ★ 跟着一起没有读者的三样，都删了：
                ① 这一节（那颗安静的入口 + 弹窗）；
                ② 删完之后的那张**终点页**（`cd__gone` 那个分支）——它只可能由这里的
                   删除动作进入，入口没了它就再也走不到；
                ③ 凭据的渲染（`DeletionReceiptRows`）与它那一份 `.dd__*` 样式。
              ★ 服务端一个字没动：`DELETE` 照旧回那份凭据（界面拿它判 `complete`），
                "删到一半"那句点名的话照旧由弹窗说出来。要恢复这一屏的删除，
                读一下 `WallDelete.tsx` 就够了——两边用的是同一个组件。 */}
    </section>
  )
}
