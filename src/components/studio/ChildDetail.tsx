'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AGE_BAND_LABELS, ANCHOR_LABELS, type AnchorSlot } from '@/lib/engine/domain.ts'
import type { ChildRecord } from '@/lib/engine/character-card/profile.ts'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'
import type { CardRevisionView } from '@/lib/children-list.ts'

/**
 * ChildDetail —— 一个孩子的形象页：看、提建议再画一版、切回旧版、删掉他（工单 03）
 *
 * 四件不显然的事：
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
 * 4. **删除的两步是"列出要失去什么"→"确认"，不是"确定吗"**（第三刀）。
 *    第二步弹的是**取回来的数字**（几本书、几版形象、每个位置各多少条），
 *    不是我们写死的一句话——因为家长需要知道的不是"你确定吗"，是"要没的是哪些"。
 *    预演与结果**共用同一个渲染组件**：两处各写一遍，就会出现
 *    "预演说删 8 条、结果说删了 7 条"这种看不出是数错了还是渲染错了的分歧。
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
  checklist: readonly string[]
}

type Busy = { kind: 'idle' } | { kind: 'revise' } | { kind: 'switch' } | { kind: 'delete' }

/**
 * 删除凭据的一行（`lib/child-deletion.ts` 的 `DeletionPlace` 的界面版）。
 * ★ 这里只声明**用得到的**那几个字段：界面不该因为引擎那边多了一个字段就要跟着改。
 */
type DeletionPlaceView = {
  place: string
  at: string
  deleted: number
  bytes?: number
  note?: string
  failed?: string
}

type DeletionReceiptView = {
  places: DeletionPlaceView[]
  books: { bookId: string; title: string }[]
  totalFiles: number
  stage: 'plan' | 'done'
  complete: boolean
}

export default function ChildDetail(props: ChildDetailProps) {
  const { profile, isDemo, demoId, revisions, anchors, checklist } = props
  const router = useRouter()
  const { settings, env, openSettings } = useSettings()

  const current = revisions.find((item) => item.isCurrent) ?? null
  /** 界面在看哪一版。默认就是现在这一版；点历史里的某一版只换"看"，不动指针 */
  const [viewing, setViewing] = useState<number | null>(current?.revision ?? null)
  const [suggestion, setSuggestion] = useState('')
  const [busy, setBusy] = useState<Busy>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 删除的两步：`plan` = 已把"要删什么"摆出来了（还没动手） */
  const [deleting, setDeleting] = useState<DeletionReceiptView | null>(null)
  const [deleted, setDeleted] = useState<DeletionReceiptView | null>(null)

  const shown = revisions.find((item) => item.revision === viewing) ?? current
  const imageReady = Boolean(env['IMAGE_MODEL'] && env['IMAGE_API_KEY'])

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
          env,
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

  /**
   * 第一步：去问"删掉他会删掉什么"。★ 这一步**一个字节都不动**。
   *
   * 为什么先问再做、而不是直接把删除按钮做成"点了就删 + 二次确认弹窗"：
   * 那种确认只能问"确定吗"，而家长真正需要知道的是**要失去什么**——
   * 几本书、几版形象、他会不会从列表里消失。这些数在服务端，
   * 所以确认框里的那句话是取回来的，不是我们写死的。
   */
  async function askDeletion(): Promise<void> {
    setBusy({ kind: 'delete' })
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/children/${encodeURIComponent(profile.childId)}`)
      const payload = (await response.json()) as { receipt?: DeletionReceiptView; message?: string }
      if (!response.ok || !payload.receipt) {
        setError(payload.message ?? '数不出要删什么')
        return
      }
      setDeleting(payload.receipt)
    } catch {
      setError('网络断了，没能问出要删什么。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  /**
   * 第二步：真删。
   *
   * ★ 凭据**两种都要**：删干净了展示它，删到一半失败也展示它
   *   （`receipt` 跟着失败响应一起回来）。只说一句"删除失败"会让人以为
   *   一样都没删，而"确实删了一半"与"什么都没删"要让家长做两件不同的事。
   * ★ 这里**不调 `router.refresh()`**，理由是把这一刀自己撞出来的：
   *   刷新之后服务端组件重新取数，而那个孩子已经不存在了 → 整页变成 404，
   *   于是**凭据刚生成就被替换掉**。而凭据是这一次删除唯一的证据，
   *   也是这一屏的全部意义所在。所以让这一屏自己变成一个终点页（见下面的渲染），
   *   由用户点"回小主角"离开，而不是把他从这一页上推下去。
   */
  async function confirmDeletion(): Promise<void> {
    setBusy({ kind: 'delete' })
    setError(null)
    try {
      const response = await fetch(`/api/children/${encodeURIComponent(profile.childId)}`, {
        method: 'DELETE',
      })
      const payload = (await response.json()) as { receipt?: DeletionReceiptView; message?: string }
      if (payload.receipt) {
        setDeleting(null)
        setDeleted(payload.receipt)
        if (!payload.receipt.complete) {
          setError(payload.message ?? '有些位置没删干净，凭据里标出来了。')
        }
        return
      }
      setError(payload.message ?? '没删掉')
    } catch {
      setError('网络断了。删除可能已经发生，也可能没有——刷新这一页看还在不在。')
    } finally {
      setBusy({ kind: 'idle' })
    }
  }

  return (
    <section className="cd">
      {deleted ? (
        /* ★ 这是一个**终点页**，不是"删除按钮下面的一行结果"：删完之后这一屏
           关于这个孩子的每一件事（形象、版本历史、锚点、提建议）都已经不成立了，
           留着它们包围一张"已删除"的凭据，只会让人以为还有东西没删。
           所以整个替换掉，只留凭据与一条出口。 */
        <div className="cd__gone">
          <p className="cd__eyebrow">
            <NextLink href="/character">← 小主角</NextLink>
          </p>
          <h1 className="cd__title">
            {deleted.complete ? `${profile.name} 已经删掉了` : `${profile.name} 只删掉了一部分`}
          </h1>
          <p className="cd__hint">
            下面是凭据。它列的是<strong>每个位置各删了多少条</strong>
            ——数字来自删除动作本身， 不是预估。
          </p>
          {error ? (
            <p className="cd__error" role="alert">
              {error}
            </p>
          ) : null}
          <DeletionReceipt receipt={deleted} done />
          <NextLink className="cd__btn" href="/character">
            回「小主角」
          </NextLink>
        </div>
      ) : (
        <>
          <header className="cd__head">
            <div>
              <p className="cd__eyebrow">
                {/* next/link 而不是 <a>：整页刷一次只为回列表，是这一屏最没必要的一笔开销 */}
                <NextLink href="/character">← 小主角</NextLink>
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
                {current ? ` · 现在这一版是第 ${current.revision} 版` : ' · 还没有形象'}
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
                  <p className="cd__art-meta">
                    第 {shown.revision} 版 · {shown.modelId}
                    {shown.isCurrent ? ' · 现在用它' : ''}
                  </p>
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
                <div className="cd__empty">
                  <p>这个孩子还没有形象。</p>
                  <p className="cd__empty-hint">
                    形象是在创作流里出的：说清楚他长什么样（几条锚点），一次就能出一张。
                    出了之后，这一屏才会长出「提建议再画一版」和版本历史。
                  </p>
                  <a className="cd__btn" href="/create">
                    去出一张形象
                  </a>
                </div>
              )}

              {revisions.length > 1 ? (
                <div className="cd__history">
                  <h2 className="cd__h2">版本历史</h2>
                  <ul className="cd__versions">
                    {/* 最新的在最上面：家长要找的是"刚才那一版" */}
                    {[...revisions].reverse().map((item) => (
                      <li key={item.revision}>
                        <button
                          type="button"
                          className="cd__version"
                          data-active={item.revision === shown?.revision}
                          onClick={() => setViewing(item.revision)}
                        >
                          <span className="cd__version-no">第 {item.revision} 版</span>
                          {item.isCurrent ? (
                            <span className="cd__version-now">现在用它</span>
                          ) : null}
                          <span className="cd__version-what">
                            {item.suggestion ?? '第一版：按锚点画的'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* ── 右边：提建议 + 这张卡凭什么算同一个人 ──────────────────────── */}
            <div className="cd__right">
              {current ? (
                <div className="cd__card">
                  <h2 className="cd__h2">想改哪里？</h2>
                  <p className="cd__hint">
                    写一句人话就行，比如「眼睛再大一点，头发短一些」。它会在上一版的基础上重画一张，
                    <strong>锚点一个字都不改</strong>——所以改坏了随时能切回来。
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
                  {!imageReady ? (
                    <p className="cd__error" role="alert">
                      还差图像模型与它的 key。
                      <button type="button" className="cd__link" onClick={openSettings}>
                        打开模型与密钥
                      </button>
                    </p>
                  ) : null}
                  {error ? (
                    <p className="cd__error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  {notice ? <p className="cd__notice">{notice}</p> : null}
                  {/* ★ 这里**没有**"AI 会尽力理解"这类话（文件头第 1 条）：改没改出来，
                  上面两版并排一放就知道，不需要我们用一句话先把责任推开 */}
                </div>
              ) : null}

              {anchors.length > 0 ? (
                <div className="cd__card">
                  <h2 className="cd__h2">这张卡凭什么算「同一个人」</h2>
                  <dl className="cd__anchors">
                    {anchors.map((anchor) => (
                      <div key={anchor.slot} className="cd__anchor">
                        <dt>{ANCHOR_LABELS[anchor.slot]}</dt>
                        <dd>{anchor.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="cd__hint">
                    画每一页时按这几条画，核对每一页时按同一批查（ADR-0007）。 上面那
                    {checklist.length}
                    条就是核对清单——「这一页还是不是他」因此有答案，而不是只有感觉。
                  </p>
                </div>
              ) : null}

              {/* 当前设置里用的图像模型：出图前能一眼看到"是谁在画" */}
              <p className="cd__foot">
                画图用的是 <code>{settings.image.model || '（没配）'}</code>。换模型在右上角的
                <button type="button" className="cd__link" onClick={openSettings}>
                  模型与密钥
                </button>
                。
              </p>
            </div>
          </div>

          {/* ── 删除（工单 03 第三刀）。★ 摆在整页最下面、字号最小的一档：
          它是一个"退到不能再退"的动作，不该与上面那些日常动作抢视线。
          删成之后的那一屏在**外面**（`deleted` 那个分支），这里只剩"要不要删" ─────── */}
          <section className="cd__danger">
            {deleting ? (
              <div className="cd__confirm">
                <h2 className="cd__h2">要删掉 {profile.name} 的这些东西：</h2>
                <DeletionReceipt receipt={deleting} />
                <p className="cd__danger-warn">
                  <strong>删了就回不来了</strong>——没有回收站，也没有备份。
                  {deleting.books.length > 0
                    ? `已经做出来的 ${deleting.books.length} 本书会一起没。`
                    : ''}
                </p>
                <div className="cd__row">
                  <button
                    type="button"
                    className="cd__btn cd__btn--danger"
                    disabled={busy.kind !== 'idle'}
                    onClick={() => void confirmDeletion()}
                  >
                    {busy.kind === 'delete' ? '正在删…' : '确认删掉'}
                  </button>
                  <button
                    type="button"
                    className="cd__btn cd__btn--ghost"
                    disabled={busy.kind !== 'idle'}
                    onClick={() => setDeleting(null)}
                  >
                    不删了
                  </button>
                </div>
              </div>
            ) : (
              <div className="cd__danger-quiet">
                {demoId ? (
                  /* ★ 示例角色不是"我们懒得做删除"，是**删不掉**：档案在 public/ 里，
                 硬删只会让他下一次从 public/ 回来、而且没有形象。理由要说出来 */
                  <p className="cd__hint">
                    {profile.name} 是随仓库发布的示例角色，<strong>不能删</strong>—— 他的档案在{' '}
                    <code>public/demo/</code> 里，是仓库的一部分。
                    真把他名下的图删掉，下一次列目录他会从那里回来，变成一个没有形象的孩子。
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="cd__btn cd__btn--ghost"
                      disabled={busy.kind !== 'idle'}
                      onClick={() => void askDeletion()}
                    >
                      {busy.kind === 'delete' ? '正在数…' : '删掉他和他的一切'}
                    </button>
                    <p className="cd__hint">
                      会先把你<strong>将要失去什么</strong>列出来，再问你一次。
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

/**
 * 删除凭据的渲染（工单 03 第三刀）。**预演与结果共用这一个组件**——
 * 两处各写一遍的症状是"预演说会删 8 条、结果说删了 7 条"，
 * 而那种不一致看不出是数错了还是渲染错了。
 */
function DeletionReceipt({
  receipt,
  done = false,
}: {
  receipt: DeletionReceiptView
  done?: boolean
}) {
  return (
    <div className="cd__receipt" data-complete={receipt.complete ? 'true' : 'false'}>
      <ul className="cd__places">
        {receipt.places.map((one) => (
          <li key={one.place} className="cd__place" data-failed={one.failed ? 'true' : 'false'}>
            <span className="cd__place-no">
              {one.failed ? '没删干净' : one.deleted > 0 ? `${one.deleted} 条` : '没有'}
            </span>
            <span className="cd__place-what">
              <strong>{one.place}</strong>
              <code className="cd__place-at">{one.at}</code>
              {one.note ? <span className="cd__place-note">{one.note}</span> : null}
              {one.failed ? <span className="cd__place-note">（{one.failed}）</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {receipt.books.length > 0 ? (
        <p className="cd__place-note">
          {done ? '已经删掉的书：' : '会一起没的书：'}
          {receipt.books.map((book) => `《${book.title}》`).join('、')}
        </p>
      ) : null}
      <p className="cd__receipt-total">
        {done ? '一共删掉' : '一共要删'} {receipt.totalFiles} 条。
        {/* ★ 照片那一行的 0 是个**说明**，不是"没删到"——凭据自己带着那句话，这里不重复 */}
      </p>
      {done && !receipt.complete ? (
        <p className="cd__danger-warn">
          这张凭据<strong>不完整</strong>：上面标了&ldquo;没删干净&rdquo;的位置还在。
          可以再点一次删除（重复删是安全的）。
        </p>
      ) : null}
    </div>
  )
}
