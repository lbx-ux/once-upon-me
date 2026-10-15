'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { checkAnchors } from '@/lib/engine/character-card/card.ts'
import type { CharacterAnchor } from '@/lib/engine/domain.ts'
import {
  childWordOf,
  initialState,
  stepProblems,
  toCardBody,
  type CreationState,
} from '@/lib/creation/state.ts'
import {
  MAX_PHOTO_BYTES,
  megaOf,
  PHOTO_CONSENT_POINTS,
  photoFormProblems,
} from '@/lib/photo-rules.ts'
import { AnchorFields, ChildFields } from '@/components/creation/fields.tsx'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'

/**
 * NewChild —— 「新建一个小主角」（工单 03 第二刀的那一屏）
 *
 * 两个入口，**默认是第一个**（与 spec §二之补 的答辩口径一致）：
 *
 * | 入口 | 做什么 | 进不进未成年人图像 |
 * | --- | --- | --- |
 * | 从零描述（默认） | 名字 + 年龄 + 七条外貌锚点 → 出一张标准像 | **不进** |
 * | 用他的照片 | 上面那些 **+ 一张照片**（要单独同意）→ 出一张标准像 | 进，且只在这条路上 |
 *
 * ★ 五条不显然的约定：
 *
 * 1. **照片那一路，照片只是"第一张插画的输入"，不是卡里的参考图。**
 *    存进卡的是模型画出来的那张插画（见 `lib/photo-card.ts` 文件头）。所以
 *    后面逐页画、逐页比对用的都是插画——"拿照片比插画"这个没量过的任务不会发生。
 * 2. **同意是一次勾选 + 一段能读的说明**，不是一行灰字。三条承诺从
 *    `PHOTO_CONSENT_POINTS` 来（文案的真身在那里），这里不复述——复述就会漂，
 *    而这里漂掉的是一句对家长的承诺。
 * 3. **先建档案，再出形象。** 顺序反过来的坏法很安静：卡建好了而档案没存上，
 *    那个孩子从此在「小主角」里不存在，他的形象变成一张谁也归不到名下的图。
 *    反过来（有档案、没形象）是一个**正常状态**，界面本来就会如实显示。
 * 4. **"我们做了什么"要具体。** 归一化会改那张照片（转正、压平、缩放），
 *    所以出图之后要把 `processed.notes` 逐条念出来。**不许写一句笼统的
 *    "已安全处理"**——那种话等于没说，而家长交出来的是一张他孩子的照片。
 * 5. **校验一句都不在这里写。** 孩子那三格走 `stepProblems`（与创作流同一份），
 *    照片那几格走 `photoFormProblems`（与路由同一份），锚点走引擎的 `checkAnchors`。
 */

type Mode = 'describe' | 'photo'

type Result = {
  childId: string
  cardId: string
  revision: number
  imageUrl: string
  /** 照片那条路才有：归一化对它做了什么 */
  notes: readonly string[]
}

export default function NewChild() {
  const router = useRouter()
  const { env, openSettings } = useSettings()

  const [mode, setMode] = useState<Mode>('describe')
  const [state, setState] = useState<CreationState>(() => initialState())
  const [photo, setPhoto] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const anchors = state.card.anchors
  const patchChild = (patch: Partial<CreationState['child']>) =>
    setState((current) => ({ ...current, child: { ...current.child, ...patch } }))

  const imageReady = Boolean(env['IMAGE_MODEL'] && env['IMAGE_API_KEY'])

  // 判据来自引擎与 photo-rules，这里只负责把它们**摆出来**
  const childProblems = stepProblems(state, 'child')
  const anchorProblems = checkAnchors(anchors).map((problem) => `外貌锚点：${problem}`)
  const photoProblemsLocal =
    mode === 'photo'
      ? photoFormProblems({
          name: state.child.name,
          ageBand: state.child.ageBand,
          childWord: childWordOf(state.child.lookTags),
          anchors,
          // ★ `File.size`：判"太大/没选"只需要一个数，不必先把文件读进内存
          photoBytes: photo?.size ?? 0,
          consent,
        })
      : []
  const ready = childProblems.length === 0 && anchorProblems.length === 0

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
      const made =
        mode === 'photo'
          ? await submitPhoto(childId)
          : await submitDescribe({ ...state, child: { ...state.child, childId } }, childId)

      if (!made.ok) {
        // ★ 档案已经存下了。这句话要说清楚，否则家长会以为"白填了一遍"
        setError(`${made.message}（他的档案已经存下了，去「小主角」能看到，只是还没有形象。）`)
        return
      }
      setResult(made.result)
      // 列表页要能看到这个新孩子（服务端渲染的那一屏不会自己知道）
      router.refresh()
    } catch {
      setError('网络断了。档案可能没存下——去「小主角」看一眼再决定要不要重填。')
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
    // ★ 只有显式写 'true' 才算同意（服务端也是这么读的，见 route.ts）
    form.set('consent', consent ? 'true' : 'false')
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
          <p className="nc__eyebrow">
            <NextLink href="/character">← 小主角</NextLink>
          </p>
          <h1 className="nc__title">{state.child.name}的形象出来了</h1>
          <p className="nc__lede">
            这是第 {result.revision} 版。它会成为后面每一页的参照物——每一页按它画，
            画完按同一批锚点核对。
          </p>
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
              回「小主角」
            </NextLink>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="nc">
      <header className="nc__head">
        <p className="nc__eyebrow">
          <NextLink href="/character">← 小主角</NextLink>
        </p>
        <h1 className="nc__title">新建一个小主角</h1>
        <p className="nc__lede">填一次，之后每一本书都用他——同一张角色卡可以被很多本书引用。</p>
      </header>

      <div className="nc__modes" role="radiogroup" aria-label="怎么定他的样子">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'describe'}
          className="nc__mode"
          data-active={mode === 'describe' ? 'true' : 'false'}
          onClick={() => setMode('describe')}
        >
          <span className="nc__mode-title">从零描述</span>
          <span className="nc__mode-hint">填几条他长什么样，不用任何照片</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'photo'}
          className="nc__mode"
          data-active={mode === 'photo' ? 'true' : 'false'}
          onClick={() => setMode('photo')}
        >
          <span className="nc__mode-title">用他的照片</span>
          <span className="nc__mode-hint">更像他，但要把照片交给我们处理一次</span>
        </button>
      </div>

      <div className="nc__body">
        <div className="nc__col">
          <h2 className="nc__h2">他是谁</h2>
          <ChildFields child={state.child} onPatch={patchChild} />
        </div>

        <div className="nc__col">
          <h2 className="nc__h2">他长什么样</h2>
          <p className="nc__note">
            这七条是形象唯一的判据（画的时候按它画、画完按它查）。下面几条是预填的示例，
            <strong>照着改成他的样子</strong>——预填的是&ldquo;一条锚点该细到什么程度&rdquo;，
            不是他。
          </p>
          <AnchorFields
            anchors={anchors}
            onChange={(next: CharacterAnchor[]) =>
              setState((current) => ({ ...current, card: { ...current.card, anchors: next } }))
            }
          />
        </div>
      </div>

      {mode === 'photo' ? (
        <div className="nc__photo">
          <h2 className="nc__h2">他的照片</h2>
          <ul className="nc__consent-points">
            {PHOTO_CONSENT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <label className="nc__agree">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              上面这三条我看过了，<strong>同意</strong>把我的孩子这张照片交出去处理这一次。
            </span>
          </label>
          <label className="nc__file">
            <input
              type="file"
              accept="image/*"
              // ★ 没勾同意时**连选文件都不让**：不是"选了但不传"，
              //   是这一格的目的就是被人读一遍再决定
              disabled={!consent}
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <span className="nc__file-text">
              {photo ? `${photo.name} · ${megaOf(photo.size)}` : '选一张他的照片'}
            </span>
          </label>
          <p className="nc__note">
            手机相册里的原图就行，不用先裁。短边至少 240 像素——
            太小的照片放大只会画出一张糊的，所以那种我们直接不收。 最大 {megaOf(MAX_PHOTO_BYTES)}。
          </p>
        </div>
      ) : null}

      <footer className="nc__foot">
        {!imageReady ? (
          <p className="nc__error" role="alert">
            还差图像模型与它的 key，现在出不了形象。
            <button type="button" className="nc__link" onClick={openSettings}>
              打开模型与密钥
            </button>
          </p>
        ) : null}
        {problems.length > 0 ? (
          <ul className="nc__problems">
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
        <button
          type="button"
          className="nc__btn nc__btn--primary"
          disabled={busy || !ready || problems.length > 0}
          onClick={() => void submit()}
        >
          {busy ? '正在画…' : '出他的第一张形象'}
        </button>
        <p className="nc__note nc__note--quiet">
          会先用你填的模型画一张标准像，十几秒。不满意可以随时在形象页上提建议重画——锚点不变。
        </p>
      </footer>
    </section>
  )
}
