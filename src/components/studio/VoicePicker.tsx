'use client'

/**
 * VoicePicker —— 工作台「声音」那一屏：每个音色一张贴在纸上的卡
 *
 * ★ 选音色这件事**没法用文字判断**。"天真男童音"这五个字不告诉你它念童书是什么调子——
 *   预置的两个是用户在厂商控制台里自己听过挑的，自己录的那条更是只能听。所以每张卡都能
 *   **听一句真的**，那句还是演示书第 1 页的原句（真语料，不是"测试文本一二三"），
 *   而且那句话**印在卡上**：按下去会听到什么，写在按钮旁边比藏在一个默认参数里诚实。
 *
 * ★ 卡片的配方从 `character-wall.css` 抄来（2026-10-16 用户原话「声音这一块也应该像角色卡
 *   一样是一张卡片那样」）。四条刻意不同（没有假头像、下半截是**冷纸**不是暖相纸、
 *   没有背后撑开的面板、主要动作不在悬停层里）逐条写在 `voice-picker.css` 的文件头。
 *
 * ★ 2026-10-16 第九轮（用户："感觉有点不好看，具体是哪我也说不出来"）改的是**骨架**，
 *   不是配色：卡变成上下两段（身份 / 要听的那句话），下半截贴着卡底铺满整宽；
 *   删除那颗从卡底的独立一行挪进了试听那一行；确认态与试听块二选一。
 *   四条起因都是那张截图量出来的数，逐条记在 `voice-picker.css` 的文件头。
 *
 * ★ 2026-10-16 第九轮之后，用户点的这颗钮**什么也没响**：「现在这个听一句真的是假的，根本听不了」。
 *   查下来不是代码坏了（那条路由拿真 key 打是 200 / audio/mpeg / 41,371 字节），
 *   是**这一屏在最常见的那种状态下放不出声**：ADR-0008 定的 BYO key 只在内存里活一次请求，
 *   刷新就没了，于是没配 key 的浏览器里三颗钮全是 `disabled`，而它看着几乎是活的。
 *   两处一起改：
 *   1. **预置音色的试听不再要 key**——那句语料是固定的、音色是厂商的，所以"它念这句什么样"
 *      是个**常量**：一次生成、跟着仓库走（`lib/voices/samples.ts`，ADR-0003 的同一条做法）。
 *      点下去放的是那份样本，不碰网络。克隆的那条只存在于用户自己的账号里，只能现场合成。
 *   2. 剩下**真放不出来**的那些，钮上写明要什么（「先配密钥」）并按下去开「模型与密钥」；
 *      真死的那些（音色用不了）把"能点"的信号一起收掉，不再只是字浅一档。
 *
 * ★ 2026-10-16 第二轮按用户划掉的记号删了三处，别以为漏了：
 *   页头那句说明（`.vc__sub`）、卡脚那行（音色 id + 绑定模型，**整行**）、
 *   以及原本「用自己的声音 · 还没做」那一块——它被右上角那颗「＋新建声音」兑现了
 *   （面板在 `NewVoicePanel.tsx`，样本、同意、部署状态那些规矩都在那个文件的头里）。
 *
 * ★ 「删掉它」只出现在**我录的**卡上（系统给的删不了，那是厂商的预置音色）。
 *   两步：先列出"将要失去什么"，确认后真调一次删除，成功之后给一句**报数的凭据**。
 *   照角色墙那条判断：删除的实现只有这一份，卡面上不再各写一遍。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import type { CatalogVoice } from '@/lib/voices/catalog.ts'
import { sampleFor } from '@/lib/voices/samples.ts'
import { PREVIEW_LINE } from '@/lib/settings/preview-line.ts'
import { speechReady } from '@/lib/settings/state.ts'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'
import NewVoicePanel from './NewVoicePanel.tsx'

export default function VoicePicker() {
  const { settings, patch, env, voices, forgetVoice, openSettings } = useSettings()
  const audioRef = useRef<HTMLAudioElement>(null)
  /** 当前那个一次性对象地址。换一段、播完、卸载都要 revoke —— 见文件头 */
  const urlRef = useRef<string | null>(null)
  /**
   * ★ 令牌：连点两张卡时，**先发的那次响应可能后到**，把播放器改成上一个音色。
   *   与 `CreateLanding` 那颗优化钮防双发是同一类毛病，只是这里的窗口在 fetch 上。
   *   所以每次点击领一个号，回来时对不上就整段丢弃。
   */
  const tokenRef = useRef(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 哪一张卡正展开"删掉它"的两步确认 */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  /** 删完之后的报数凭据（一件事做完要给的东西，不是一句"操作成功"） */
  const [receipt, setReceipt] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const configured = speechReady(settings)

  /** 放掉那个一次性地址。★ 先摘 `src` 再 revoke：留着一个已吊销的地址在元素上，
   *  下一次 `play()` 会报一个看不出原因的错 */
  const releaseUrl = (): void => {
    const el = audioRef.current
    if (el) el.removeAttribute('src')
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }

  // 离开这一屏：地址与播放一起放掉（组件卸载时 el 已经没了，所以先取引用）
  useEffect(() => {
    const el = audioRef.current
    const url = urlRef
    return () => {
      el?.pause()
      if (url.current) URL.revokeObjectURL(url.current)
    }
  }, [])

  const stop = (): void => {
    audioRef.current?.pause()
    releaseUrl()
    setPlaying(null)
  }

  const preview = async (voiceId: string): Promise<void> => {
    const el = audioRef.current
    if (!el) return
    // 同一张卡再点一次 = 停下（按钮自己会变成"正在听…"，用户按它就是想停）
    if (playing === voiceId) {
      stop()
      return
    }
    // 换一张卡：**先把上一段停掉**。不停的话旧的那段还在响，而按钮已经改口说新的在放，
    // 两头对不上——而"哪一段在响"正是这一屏唯一要读准的事
    el.pause()
    releaseUrl()
    const token = tokenRef.current + 1
    tokenRef.current = token
    setError(null)
    setPlaying(voiceId)

    // ★ 预置音色放的是**跟着仓库走的样本**（`lib/voices/samples.ts`）：不碰网络，
    //   不需要 key。这一屏的存在理由是"音色没法用文字判断，必须能听"，
    //   所以它不能是"只有配过 key 的机器才听得见"——用户报的"这个是假的"就是这个形状。
    const sample = sampleFor(voiceId)
    if (sample) {
      try {
        el.src = sample.url
        await el.play()
        return
      } catch (err) {
        if (tokenRef.current !== token) return
        setError(
          `样本放不出来（${sample.url}）：${err instanceof Error ? err.message : String(err)}`,
        )
        setPlaying(null)
        return
      }
    }

    // 克隆出来的那条只能现场合成：它只存在于用户自己的厂商账号里，没有样本可带
    try {
      const response = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env, voiceId, text: PREVIEW_LINE }),
      })
      if (!response.ok) {
        throw new Error((await response.text()).slice(0, 120) || `HTTP ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      // 已经被后一次点击取代：这次的结果整个丢掉，连地址都不建
      if (tokenRef.current !== token) return
      releaseUrl()
      const url = URL.createObjectURL(
        new Blob([buffer], { type: response.headers.get('content-type') ?? 'audio/mpeg' }),
      )
      urlRef.current = url
      el.src = url
      await el.play()
      // ★ 这里**不**把 playing 清掉：音频才刚开始响，"正在听…"要一直亮到
      //   ended / pause / 出错（以前在 finally 里清，于是按钮在出声前就变回去了）
    } catch (err) {
      if (tokenRef.current !== token) return
      setError(err instanceof Error ? err.message : String(err))
      setPlaying(null)
    }
  }

  /** 真删。★ 失败就说失败，且**不把本地那条记录删掉**——否则列表里那条"没了"，
   *  而厂商那边还在，下一次克隆会撞上一个没人记得的旧音色 */
  const removeVoice = async (voice: CatalogVoice): Promise<void> => {
    setDeleting(voice.id)
    setError(null)
    try {
      const response = await fetch('/api/voice/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ env, voiceId: voice.id }),
      })
      if (!response.ok) {
        throw new Error((await response.text()).slice(0, 160) || `HTTP ${response.status}`)
      }
      const data = (await response.json()) as { released?: boolean }
      const wasCurrent = settings.speech.voice === voice.id
      forgetVoice(voice.id)
      setConfirming(null)
      setReceipt(
        (data.released
          ? `已删掉「${voice.name}」：厂商侧已解绑（再拿它合成会 400）。`
          : `「${voice.name}」这条记录删了，但厂商没有确认解绑——它可能还留在你的账号里。`) +
          (wasCurrent ? '当前音色已清空，去挑一个。' : ''),
      )
    } catch (err) {
      setError(`没删掉：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <section className="vc">
      <header className="vc__head">
        <div>
          <h1 className="vc__title">声音</h1>
          {/* 2026-10-16 用户先划掉了原来那两句话的说明，又要一句**短的**。
              长短是这一次唯一的判据：一句说明"这个音色是干什么用的"就够，
              "已经做完的书不会重录"那半句属于设置页的解释，不属于页头 */}
          <p className="vc__sub">选一个音色，之后做的每一本书都用它念。</p>
        </div>
        {/* ★ 与 `/character` 那一屏的「＋新建角色」同一处、同一个长相：这一屏的"造东西" */}
        <button type="button" className="vc__new" onClick={() => setPanelOpen(true)}>
          <span className="vc__new-plus" aria-hidden="true">
            ＋
          </span>
          新建声音
        </button>
      </header>

      {receipt && (
        <p className="vc__receipt" role="status">
          {receipt}
          <button type="button" className="vc__receipt-x" onClick={() => setReceipt(null)}>
            知道了
          </button>
        </p>
      )}

      <ul className="vc__wall">
        {voices.map((voice, index) => {
          const selected = settings.speech.voice === voice.id
          const busy = playing === voice.id
          const openConfirm = confirming === voice.id
          /**
           * 随包的那份样本。★ 只有**预置**音色走这条路：样本是"厂商那个音色的这一句"，
           * 不是"任何 id 长这样的音色"。克隆出来的 id 是厂商给的、与预置的不可能撞，
           * 但这条判据不该靠"撞不上"——真撞上就会拿一份别人的录音当成用户自己的声音播。
           */
          const sample = voice.source === 'preset' ? sampleFor(voice.id) : null
          /**
           * ★ 没有样本、又没配 key：这颗钮**放不出这句话**（克隆的那条只能现场合成）。
           *   但它**不是死的** —— 按下去开「模型与密钥」。一个看起来能点、点了什么都不发生的
           *   钮就是用户说的"这个是假的"（2026-10-16 实测：旧版这颗钮 `disabled`，
           *   而除了字浅一档，边、底、透明度与能点的那颗一模一样）。
           * ★ 带上 `voice.usable`：音色根本用不了的时候，钮是**死的**（`disabled`），
           *   说"先配密钥"会把病因指错——那一种是"模型对不上"，理由由卡上的 `.vc__why` 说。
           */
          const needsKey = voice.usable && !sample && !configured
          const listenLabel = busy ? '正在听…' : needsKey ? '先配密钥' : '听一句真的'
          return (
            <li key={voice.id} className="vc__slot" style={{ '--vc-i': index } as CSSProperties}>
              <article className="vc__card" data-selected={selected} data-source={voice.source}>
                {/* 上半截：身份（名字 / 调性 / 状态 / 以及"用不了"那句话）。
                    ★ 2026-10-16 第九轮：卡改成**两段式**，两段各自带内边距
                      （见 `voice-picker.css` 的 `.vc__top` 与 `.vc__plate`）——
                      于是卡里只有一条文字左缘。旧版名字缩进 18px、那句语料缩进 33px，
                      同一张卡里两条左缘。 */}
                <div className="vc__top">
                  {/* 名字那一行**就是**选中它的那颗钮：要选的是这一整块，热区就该是这一整块 */}
                  <button
                    type="button"
                    className="vc__pick"
                    onClick={() => patch('speech', { voice: voice.id })}
                    aria-pressed={selected}
                    disabled={!voice.usable}
                  >
                    <span className="vc__name">{voice.name}</span>
                    <span className="vc__state">
                      {voice.usable ? (selected ? '当前音色' : '选它') : '用不了'}
                    </span>
                  </button>

                  {/* 调性那句话是**厂商的说法**，不是我们的形容词。
                    ★ 我录的那条**没有这一行**（2026-10-16 用户划掉的）：它不是厂商音色，
                      没有"调性"这回事，而"用你自己录的那段声音合成"那句是**同义反复**——
                      卡片是谁的，看名字就知道。
                    ★ 同理没有"录于某天"：日期对"要不要用这个声音"没有帮助，
                      它是记账，不是判据（建它时的模型只在"对不上"时出现，那才是判据）。 */}
                  {voice.source === 'preset' ? <p className="vc__tone">{voice.tone}</p> : null}

                  {!voice.usable && voice.why ? (
                    <p className="vc__why" role="status">
                      {voice.why}
                    </p>
                  ) : null}
                </div>

                {/* 肖像位。角色卡那里裱的是一张照片；音色没有形象，
                    所以这一格裱的是**你要听到的那句话**。
                    ★ 2026-10-16 第九轮：这一块与"删掉它"的确认改成**二选一**——
                      点了删除之后整块换成确认，而不是叠在它上面（叠着的话底下会留下
                      一颗看不见却 Tab 得到的试听钮）。 */}
                {openConfirm ? (
                  <div className="vc__confirm" role="alertdialog" aria-label={`删掉 ${voice.name}`}>
                    <p className="vc__confirm-title">删掉「{voice.name}」会失去：</p>
                    <ul className="vc__confirm-list">
                      <li>
                        这条音色本身。<strong>录它的那段录音我们没有留</strong>
                        ，所以删了就再拼不回来，只能重录。
                      </li>
                      <li>以后做的书不能再选它（已经做好的书照旧有声——朗读是那一本书的产物）。</li>
                    </ul>
                    <div className="vc__confirm-acts">
                      <button
                        type="button"
                        className="vc__danger"
                        onClick={() => void removeVoice(voice)}
                        disabled={deleting === voice.id}
                      >
                        {deleting === voice.id ? '正在删…' : '确认删掉'}
                      </button>
                      <button
                        type="button"
                        className="vc__cancel"
                        onClick={() => setConfirming(null)}
                        disabled={deleting === voice.id}
                      >
                        算了
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="vc__plate">
                    <p className="vc__line">“{PREVIEW_LINE}”</p>
                    <div className="vc__actions">
                      <button
                        type="button"
                        className="vc__listen"
                        data-playing={busy ? 'true' : 'false'}
                        data-needs-key={needsKey ? 'true' : 'false'}
                        onClick={() => (needsKey ? openSettings() : void preview(voice.id))}
                        disabled={!voice.usable}
                        aria-label={
                          busy
                            ? `正在听：${voice.name}`
                            : needsKey
                              ? `先配密钥：${voice.name} 的试听要现场合成（打开模型与密钥）`
                              : `听一句真的：${voice.name}（就上面那一句）`
                        }
                        /* ★ 2026-10-16 用户把页头那条警示（"语音还没配齐…"）划掉了。
                       它说的那件事没有消失，只是**不再占一整行**：没配齐时这颗钮的**字**就写着
                       "先配密钥"，按下去直接开抽屉——比一条横幅短，而且只有真受影响的那张卡说。
                       ★ 别把它挪回成一整条横幅：用户划掉的正是"这一屏替用户把设置里的问题念一遍"。 */
                        title={
                          !voice.usable
                            ? '这个音色现在用不了，原因写在上面'
                            : needsKey
                              ? `「${voice.name}」是你自己录的音色，厂商那边才有它，所以试听要现场合成——先把 Key 与模型填上`
                              : sample
                                ? '这一份是随仓库带的样本（预生成），不需要 key；按下去听的就是它'
                                : undefined
                        }
                      >
                        {/* 只有**真会响**的时候才挂播放图标：钮上写着"先配密钥"却画一个喇叭，
                            正是"控制与它做的事对不上"那类错 */}
                        {needsKey ? null : (
                          <svg className="vc__listen-icon" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M3.5 7.5h2.8L10 4.2v11.6l-3.7-3.3H3.5z" />
                            <path
                              d="M12.8 7.4a3.4 3.4 0 0 1 0 5.2M15.2 5.2a6.6 6.6 0 0 1 0 9.6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        )}
                        {listenLabel}
                      </button>

                      {/* ── 删掉它（只有我录的有）────────────────────────────────
                      ★ 两步：先列出"将要失去什么"，再动手。**不是**一颗点了就删的垃圾桶。
                      ★ 2026-10-16 第九轮它挪进了这一行钮的**最右**（`margin-left: auto`）：
                        旧版它在卡底独占一行，于是我录的那张卡底下留了 59px 空白、里面
                        只有这一枚 17px 图标，而另外两张同样位置只有 14px —— 同一款卡
                        长出了两副骨架。现在三张卡的下半截结构一模一样。
                      ★ 同一行不等于同权重：它是 32px 的透明底图标钮，点下去还有两步确认。 */}
                      {voice.source === 'mine' ? (
                        /* ★ 2026-10-16 用户要求把它换成一个删除图标（原来是"删掉它"三个字）。
                       ★ 只有图标就**必须**补两个东西：`aria-label`（读屏念得到）与
                         `title`（鼠标停一下能看到它是什么、以及删了会怎样）——
                         同 `CreateLanding` 那颗优化钮的处理。
                       ★ 图标**重画过一次**（第一版用户说"不好看"）：那一版在 20 的格子里
                         还塞了两条竖线当桶纹，缩到 17px 之后两条 1.5 的线糊成一团，
                         整个图形读起来像个珊瑚。现在只用三笔——**盖、提手、桶身**——
                         按 24 的格子、1.6 的线宽画：小尺寸下**少一笔比多一笔好看**。 */
                        <button
                          type="button"
                          className="vc__del"
                          onClick={() => setConfirming(voice.id)}
                          aria-label={`删掉这个音色：${voice.name}`}
                          title={`删掉「${voice.name}」：录它时的那段录音我们没有留，删了只能重录`}
                        >
                          <svg className="vc__del-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <g
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              {/* 盖 */}
                              <path d="M4.6 7.4h14.8" />
                              {/* 提手 */}
                              <path d="M9.6 7.4V5.6A1.6 1.6 0 0 1 11.2 4h1.6a1.6 1.6 0 0 1 1.6 1.6v1.8" />
                              {/* 桶身：往下收一点，读得出是个桶而不是个方框 */}
                              <path d="M7.3 7.4l.82 11.1a1.8 1.8 0 0 0 1.8 1.7h4.16a1.8 1.8 0 0 0 1.8-1.7l.82-11.1" />
                            </g>
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </article>
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="vc__error" role="alert">
          {error}
        </p>
      )}

      {/* 试听是一次性的：不缓存、不进资产根 */}
      <audio
        ref={audioRef}
        aria-hidden="true"
        onEnded={() => {
          releaseUrl()
          setPlaying(null)
        }}
      />

      {panelOpen && <NewVoicePanel onClose={() => setPanelOpen(false)} />}
    </section>
  )
}
