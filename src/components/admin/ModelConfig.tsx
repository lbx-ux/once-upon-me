'use client'

/**
 * ModelConfig —— 管理页上的模型配置（用户 2026-10-17 要的）
 *
 * 用户的原话：「可以更换模型、更换模型的 api 网站、更换模型的 api-key」。
 * 在这之前换一次模型要 SSH 上去改 `.env.local` 再重启 Next。
 *
 * ★ 四条判断：
 *
 * 1. **每一行都显示"现在实际生效的是什么"**，而那句话是**引擎自己说的**
 *    （`describeProviders(serverEnv())`，服务端读出来的那四句），不是这一层
 *    拼的。这样"管理页上写着的"与"引擎实际会做的"是同一句话——拼一份的话，
 *    迟早会出现在界面上说 qwen、实际打到别处去的那种事。
 *
 * 2. **API key 只进不出**。这一屏上从来没出现过 key 的值（服务端不给），
 *    所以输入框只能是空的，旁边写着"已配置，留空表示不改"。
 *    站长因此看不出"现在这把是哪一个"——那是**故意**的（见 `model-config.ts`
 *    文件头）。代价换来的是：这个页面被截图、被开发者工具翻、被浏览器缓存，
 *    都不会漏出 key。
 *
 * 3. **空 = 不改，清空是另一个按钮**。只想换个模型名的人，不该因为
 *    「key 那一格空着」就把已经配好的 key 清掉——而那个后果要到下一次生成
 *    才出现（401），那时他早忘了自己刚动过什么。
 *
 * 4. **「恢复默认」要说清会发生什么**。它把这一行从覆盖里去掉、回到
 *    `.env.local`。★ 而"那边有没有配"是**两件完全不同的事**：
 *    有配 = 回到旧值；没配 = 这一项变成空的、**这个能力当场就用不了了**。
 *    所以确认框里的那句话按 `fallback` 分开写，不写一句笼统的"确定吗"。
 *
 * ── 2026-10-18 加的三样（用户给了四张参考截图：「模型选择可以弄成这样的」）────
 *
 * · **「厂商 / 网关」下拉**（`lib/settings/gateways.ts`）：选一家就把「接口地址」
 *   填好。换一家手抄地址的坏法是抄错一个字母而**保存成功**，一直到真的生成一本书
 *   才以 404 的面目出现。★ 它**只填地址**，不填模型名（模型名不写死那条验收），
 *   而且那张表是**地址书签不是背书**——本仓只实测过当下在用的那一家，
 *   所以下拉底下跟着一句"选完点测试连通就知道通不通"。
 * · **「拉取模型列表」挪到「模型名」右边**（原来在卡片底部那行灰字里）。
 * · ★ **「测试连通」**：拿现在生效的那份配置**真打一次**（`/api/admin/model-test`），
 *   通了就把结果给出来——图显示出来、音频能播、文字与视觉把它说的话写出来。
 *   在这之前这一屏**只能填**，配错了要等到生成一本书才发现，而那条路上最贵的一步
 *   是出图（0.2 元/张、一页十几秒）。
 *   ★ 它发出去的那点东西由服务端写着（`TEST_REQUEST`），卡片副标题说的就是它——
 *     两处各写一份的话，副标题会停在"64 token"而实际发 4096。
 */

import { useCallback, useEffect, useState } from 'react'

import {
  clearModelConfig,
  fetchModelCandidates,
  saveModelConfig,
  testModelCapability,
} from '@/lib/admin/client.ts'
import { ANCHOR_LABELS } from '@/lib/engine/domain.ts'
import { CUSTOM_GATEWAY_ID, gatewayOf, gatewaysFor } from '@/lib/settings/gateways.ts'
import type {
  FieldId,
  ModelCandidates,
  ModelConfigView,
  ModelTestResult,
  SectionView,
} from '@/lib/settings/model-config-state.ts'

import Fold from './Fold.tsx'

/** 那一行小字：这一格现在的值是从哪儿来的 */
function sourceLabel(field: SectionView['fields'][number]): string {
  if (field.source === 'admin') {
    return field.fallback ? '管理页（清掉还有环境变量兜底）' : '管理页（清掉就没值了）'
  }
  if (field.source === 'env') return '环境变量'
  return '还没配'
}

/** 一次测试花了几秒。★ 一位小数就够：这个数用来判断"这一家能不能用来出图" */
function secondsOf(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/** 一个能力那一张卡 */
function Section({
  section,
  effective,
  onView,
}: {
  section: SectionView
  /** 引擎说的那一句（`describeProviders` 的一行） */
  effective: string | undefined
  onView: (view: ModelConfigView) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  // ★ 秘密那一格永远从空开始（值根本到不了这里）。别的格子从当前值开始，
  //   因为站长要看着当前模型改
  const [draft, setDraft] = useState<Record<FieldId, string>>(() => draftsOf(section))

  const changed = section.fields.some((field) =>
    field.secret
      ? draft[field.id].trim() !== ''
      : draft[field.id].trim() !== (field.value ?? '').trim(),
  )
  const hasOverride = section.fields.some((field) => field.source === 'admin')

  /* ── 「厂商 / 网关」（2026-10-18）─────────────────────────────────────────
   * ★ 选中只改**草稿**里那一格，不自动保存：保存仍是那颗按钮的事。
   *   自动保存的话，"选错了"会当场写进磁盘上那份配置，而这一屏上别的格子
   *   可能还有半截没填完的改动。
   * ★ 「自定义」是空地址，选它**什么都不动**——它的意思是"别动我的格子"，
   *   而不是"把地址清空"（清空是「恢复默认」那个动作）。 */
  const [gatewayId, setGatewayId] = useState(() => gatewayOf(baseUrlOf(section), section.id).id)
  const gateway = gatewaysFor(section.id).find((item) => item.id === gatewayId)

  /* ── 「模型名」那一格的候选（2026-10-17）─────────────────────────────────
   * 站长问的是「不是输入地址，就可以获取模型列表了吗」——能，列表就是
   * `{接口地址}/models` 那一份（`lib/settings/model-list.ts`）。
   *
   * ★ 它**不是**把 `模型名` 那一格做成强制选择框：这个网关的 `/models` 只列对话模型，
   *   图像在用的 `wan2.7-image` **不在**那 26 个里——做成强制选择的话，
   *   图像那一格会当场丢掉它正在用的值。那一格永远是自由文本，候选只是候选。
   * ★ 挑候选用的是**旁边那颗真的 `<select>`**，不是 `<input list>` + `<datalist>`
   *   （2026-10-18 用户报的：「你这里写的拉取到了，可是我点击下拉框没有啊」）。
   *   病根是 `datalist` 的**原生过滤**：Chrome 拿输入框里现有的字去筛候选，
   *   而这一格平时**是填好的**（`qwen3.8-flash`），26 个里只有它自己匹配得上
   *   ——于是"拉到了 26 个"与"点开只有一个"同时成立。
   *   那个过滤是浏览器的行为，改不了；所以换成一颗列全部候选的选择框：
   *   它自己不存值（选完就弹回占位项），选中的那个**写进自由文本框**。
   * ★ 挂载时拉一次（每张卡一次）。失败**不是错误**：地址没配、key 不对、
   *   那个地址没有 `/models`（语音那一路很可能就是），都只是"没有候选"。
   * ★ 用的是**服务端那份配置里**的地址，不是正在输入的那一格：还没保存的地址
   *   在服务端不存在，而这里要拉的是"此刻真在生效的那个"。改完地址点保存，
   *   下面那句会自动重拉一次（`save()` 里那一行）。 */
  const [candidates, setCandidates] = useState<ModelCandidates | null>(null)
  const [pulling, setPulling] = useState(false)

  const pull = useCallback(async () => {
    setPulling(true)
    const result = await fetchModelCandidates(section.id)
    setCandidates(
      result.ok
        ? result.data
        : { ok: false, endpoint: '', ids: [], message: `读不到候选：${result.message}` },
    )
    setPulling(false)
  }, [section.id])

  useEffect(() => {
    void pull()
  }, [pull])

  /* ── 「测试连通」（2026-10-18）───────────────────────────────────────────
   * ★ 两种东西分开存，因为它们要说的话不一样：
   *   · `testFail` —— 这一按**根本没发出去**，或者厂商说了不行（一句能照做的话）；
   *   · `tested.ok` —— 真通了，下面要画的是**通的证据本身**。
   * ★ 预填值与副标题都从服务端来（见文件头最后一段），浏览器不另写一份。 */
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<ModelTestResult | null>(null)
  const [testFail, setTestFail] = useState<string | null>(null)
  /** 图像那一支：这一次测试用的提示词（**不保存**，它不是配置） */
  const [testPrompt, setTestPrompt] = useState(section.testSeed)
  /** 视觉那一支：选的本地图片（data URL）。★ 只在这台浏览器与那一条请求里 */
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null)

  async function runTest() {
    if (testing) return
    setTesting(true)
    setTested(null)
    setTestFail(null)

    const outcome = await testModelCapability(section.id, {
      ...(section.id === 'image' ? { prompt: testPrompt } : {}),
      ...(section.id === 'vision' && photo ? { photo: photo.dataUrl } : {}),
    })

    if (!outcome.ok) {
      // 这一按没发出去（没权限、缺一格配置、网络不通）
      setTestFail(outcome.message)
    } else if (!outcome.data.ok) {
      // 发出去了，厂商那边说不行——那句话带着厂商的原文（`adminFailureOf` 翻的）
      setTested(outcome.data)
      setTestFail(outcome.data.message ?? '这一次没通，但服务端没说是为什么')
    } else {
      setTested(outcome.data)
    }
    setTesting(false)
  }

  /** 选一张本地图片。★ 用 FileReader 读成 data URL：不经过任何服务器，先在这台机器上 */
  function pickPhoto(file: File | undefined) {
    if (!file) {
      setPhoto(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (dataUrl !== '') setPhoto({ name: file.name, dataUrl })
    }
    reader.readAsDataURL(file)
  }

  async function save() {
    if (busy || !changed) return
    setBusy(true)
    setNote(null)

    // ★ 只送**这一行真有**的那几格（草稿里那四个键是全集，但文字能力没有 `voice`）。
    //   全都送的话，服务端会把"多出来的字段"当成错误——那是刻意的：
    //   字段名拼错必须说出来，而不是"保存成功但什么都没改"。
    // ★ 秘密那一格空着就照原样送空：服务端把空理解成"这次不改"（文件头第 3 条）
    const payload: Record<string, string> = {}
    for (const field of section.fields) payload[field.id] = draft[field.id]

    const result = await saveModelConfig(section.id, payload)
    if (result.ok) {
      onView(result.data)
      // ★ 成功之后**用服务端那份重填草稿**：key 那一格因此被清掉
      //   （它已经交出去了，没有理由继续挂在这台电脑的屏幕上），
      //   别的格子回到服务端说的那个值
      const fresh = result.data.sections.find((item) => item.id === section.id)
      if (fresh) {
        setDraft(draftsOf(fresh))
        // 地址可能刚被改掉：下拉要跟着停在新地址对应的那一家（认不出就是「自定义」）
        setGatewayId(gatewayOf(baseUrlOf(fresh), section.id).id)
      }
      setNote({ text: `${section.label}：改好了，下一次生成开始用新的`, bad: false })
      // ★ 地址可能刚被改掉，候选得跟着重拉一次（见上面 `pull` 那段）
      void pull()
      // ★ 配置变了，上一次的测试结果就**不再是现在这套配置的结果**——
      //   留着它比没有更坏：站长会以为自己刚改的这份已经验过了
      setTested(null)
      setTestFail(null)
    } else {
      setNote({ text: `没改成：${result.message}`, bad: true })
    }
    setBusy(false)
  }

  async function reset() {
    if (busy) return
    const risky = section.fields.find((field) => field.source === 'admin' && !field.fallback)
    const question = risky
      ? `${section.label}这一行会回到 .env.local 里的值。\n\n` +
        `注意：环境变量里「${risky.label}」是没有的，所以清掉之后这一项就空了——` +
        `${section.label}这个能力会直接用不了，直到你重新填上。\n\n确定吗？`
      : `${section.label}这一行会回到 .env.local 里的值（那边都有配，不会空）。\n\n确定吗？`
    if (!window.confirm(question)) return

    setBusy(true)
    setNote(null)
    const result = await clearModelConfig(section.id)
    if (result.ok) {
      onView(result.data)
      const fresh = result.data.sections.find((item) => item.id === section.id)
      if (fresh) {
        setDraft(draftsOf(fresh))
        setGatewayId(gatewayOf(baseUrlOf(fresh), section.id).id)
      }
      setNote({ text: `${section.label}：回到环境变量那一份了`, bad: false })
      void pull()
      setTested(null)
      setTestFail(null)
    } else {
      setNote({ text: `没恢复成：${result.message}`, bad: true })
    }
    setBusy(false)
  }

  return (
    <article className="adm__model">
      <header className="adm__model-head">
        <h3 className="adm__model-name">
          {section.label}
          {/* ★ 那一粒药丸：这个能力是干什么用的（写故事 / 画插画 / 核对面孔 / 朗读）。
              它现在是一粒真的胶囊（`.adm__badge`），不再是一行灰字——
              四张卡里最先被读到的就是这一格 */}
          <span className="adm__badge">{section.hint}</span>
        </h3>
        {/* ★ 这一按会做什么（服务端写的，见文件头最后一段）。它比"测试连通"
            那四个字重要：一句话、64 token 上限、与跨页插画同一个尺寸，
            都是站长判断"这一项能不能用"的一半判据 */}
        <p className="adm__model-sub">{section.testLine}</p>
        {/* ★ 引擎自己那一句（文件头第 1 条） */}
        <p className="adm__model-live" title="引擎读到的配置，不是这一页拼的">
          {effective ?? '（引擎没说这一项）'}
        </p>
      </header>

      {/* ── 厂商 / 网关：选一家就把地址填好（只填地址，见文件头）────────────── */}
      <label className="adm__model-field adm__model-field--wide">
        <span className="adm__model-label">厂商 / 网关</span>
        <select
          className="adm__model-select"
          value={gatewayId}
          onChange={(event) => {
            const picked = event.target.value
            setGatewayId(picked)
            const item = gatewaysFor(section.id).find((one) => one.id === picked)
            // ★ 「自定义」空地址 = 别动我的格子；选它只是把下拉停在那儿
            if (item && item.id !== CUSTOM_GATEWAY_ID && item.baseUrl !== '') {
              setDraft((all) => ({ ...all, baseUrl: item.baseUrl }))
            }
          }}
        >
          {gatewaysFor(section.id).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {/* ★ 这张表是**地址书签不是背书**：除了当下在用的那一家，本仓没有逐个实测过。
          不说这一句，站长会以为"选中的那家一定对" */}
      <p className="adm__model-gatewaynote">
        {gateway?.note ? <span>{gateway.note} </span> : null}
        这些地址是照各家文档抄的，本仓只实测过当下在用的那一家——选完点「测试连通」就知道通不通。
      </p>

      <div className="adm__model-fields">
        {section.fields.map((field) => (
          <label className="adm__model-field" key={field.id}>
            <span className="adm__model-label">
              {field.label}
              <span className="adm__model-source" data-src={field.source ?? 'none'}>
                {sourceLabel(field)}
              </span>
            </span>
            <span className="adm__model-line">
              <input
                // ★ 秘密那一格用 password：站长输 key 的时候旁边可能有人
                type={field.secret ? 'password' : 'text'}
                value={draft[field.id]}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  field.secret
                    ? field.configured
                      ? '已配置，留空表示不改'
                      : '还没配，粘一个进来'
                    : field.configured
                      ? '留空表示不改'
                      : '还没配'
                }
                onChange={(event) =>
                  setDraft((all) => ({ ...all, [field.id]: event.target.value }))
                }
              />
              {/* ★ 「拉取模型列表」在模型名**旁边**（2026-10-18 从卡片底部那行灰字挪上来）：
                  站长填这一格时最需要的就是它，而原来那句话离他两格远 */}
              {field.id === 'model' ? (
                <button
                  type="button"
                  className="adm__act"
                  disabled={pulling}
                  title="按现在生效的接口地址拉一次（改完地址要先保存）"
                  onClick={() => void pull()}
                >
                  {pulling ? '在拉…' : '拉取模型列表'}
                </button>
              ) : null}
              {/* ★ 候选挑一个（2026-10-18 换掉 `datalist`，理由见上面 `pull` 那段）。
                  它**自己不存值**：选完立刻弹回占位项（`value=""` 是受控的固定值），
                  选中的那个写进左边那格自由文本框——所以"挑一个"与"自己填"
                  共用同一个落点，也不会把不在候选里的值（`wan2.7-image`）弄丢。
                  拉不到候选时**不画它**：一颗只有占位项的空下拉比没有更坏。
                  ★ 它**独占一行**（CSS 里 `flex-basis: 100%`），不是"挤在右边"：
                    这一屏最宽 1120px，三个字段一行各 ~341px，装上输入框 + 「拉取模型列表」
                    就再放不下 190px 的选择框了。既然无论窗口多大都在下面，
                    下面那句灰字就说「下面那颗」——方向词得跟量出来的排版对得上。 */}
              {field.id === 'model' && (candidates?.ids.length ?? 0) > 0 ? (
                <select
                  className="adm__model-pick"
                  value=""
                  aria-label={`从拉到的 ${candidates?.ids.length ?? 0} 个模型候选里挑一个`}
                  onChange={(event) => {
                    if (event.target.value === '') return
                    setDraft((all) => ({ ...all, model: event.target.value }))
                  }}
                >
                  <option value="">挑一个（{candidates?.ids.length ?? 0}）</option>
                  {(candidates?.ids ?? []).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      {/* 候选从哪儿来（见上面 `pull` 那段）。★ 这句话**永远灰的**：
          "没有候选"不是"坏了"，红字在这一屏只有"这一轮真的坏了"一个意思 */}
      <p className="adm__model-cand">
        {pulling
          ? '正在从接口地址那边拉模型列表…'
          : candidates === null
            ? ''
            : candidates.ok
              ? `${section.label}：从接口地址拉到 ${candidates.ids.length} 个模型候选（下面那颗「挑一个」里是全的，也可以直接填）`
              : candidates.message}
        {candidates?.ok ? <code>{candidates.endpoint}</code> : null}
      </p>

      {section.warn ? <p className="adm__model-warn">{section.warn}</p> : null}

      {/* ── 测试连通 ─────────────────────────────────────────────────────── */}
      <div className="adm__test">
        {section.id === 'image' ? (
          <label className="adm__model-field adm__model-field--wide">
            <span className="adm__model-label">提示词（只用于这一次测试，不保存）</span>
            <input
              type="text"
              value={testPrompt}
              spellCheck={false}
              placeholder={section.testSeed}
              onChange={(event) => setTestPrompt(event.target.value)}
            />
          </label>
        ) : null}

        {section.id === 'vision' ? (
          <label className="adm__model-field adm__model-field--wide">
            <span className="adm__model-label">
              本地图片（只在这条请求里，不落盘）
              {photo ? <span className="adm__model-source">{photo.name}</span> : null}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => pickPhoto(event.target.files?.[0])}
            />
          </label>
        ) : null}

        {section.id === 'speech' ? (
          <p className="adm__model-label">
            要念的那一句：<code>{section.testSeed}</code>
          </p>
        ) : null}

        <div className="adm__test-go">
          <button
            type="button"
            className="adm__newgo"
            // ★ 视觉没有图就没得试（服务端也会拒，但那要等一个来回）
            disabled={testing || (section.id === 'vision' && !photo)}
            onClick={() => void runTest()}
          >
            {testing ? '在试…' : '测试连通'}
          </button>
          {section.id === 'image' ? (
            // ★ 钱要说在按钮旁边，不是写在文档里：这一格按下去是一口价 0.2 元/张
            //   （与 `.env.example` 的 IMAGE_UNIT_COST_CNY 同一个数）
            <span className="adm__model-tip">这一次会真花钱：出图一口价 0.2 元/张</span>
          ) : null}
          {section.id === 'vision' && !photo ? (
            <span className="adm__model-tip">先选一张本地图片</span>
          ) : null}
        </div>

        {/* 通了：一句话 + **通的证据本身**（图 / 声 / 它说的话） */}
        {tested?.ok ? (
          <div className="adm__test-out">
            <p className="adm__model-note" role="status">
              通了 · {secondsOf(tested.ms)} 秒{tested.modelId ? ` · ${tested.modelId}` : ''}
            </p>
            {tested.imageDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="adm__test-shot" src={tested.imageDataUrl} alt="这一次测试出的图" />
            ) : null}
            {tested.audioDataUrl ? (
              <audio className="adm__test-audio" controls src={tested.audioDataUrl} />
            ) : null}
            {tested.text ? <p className="adm__test-said">{tested.text}</p> : null}
            {tested.anchors.length > 0 ? (
              <ul className="adm__test-anchors">
                {tested.anchors.map((item) => (
                  <li key={item.slot}>
                    <span>
                      {ANCHOR_LABELS[item.slot as keyof typeof ANCHOR_LABELS] ?? item.slot}
                    </span>
                    {item.value}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* 没通：一句能照做的话（厂商原文附在后面，`adminFailureOf` 拼的） */}
        {testFail ? (
          <p className="adm__model-note" data-bad="true" role="status">
            {testFail}
          </p>
        ) : null}
      </div>

      <div className="adm__model-actions">
        <button
          type="button"
          // ★ 2026-10-18：这个类名原来写的是 `adm__req-go`，而它在 `admin.css` 里
          //   **一处都没有**（删申请队列那次之前的遗留）——也就是说这颗保存按钮
          //   一直是浏览器默认样式。换成页面上真有的那颗主按钮（建号表单在用同一个）
          className="adm__newgo"
          disabled={busy || !changed}
          onClick={() => void save()}
        >
          {busy ? '在存…' : '保存'}
        </button>
        <button
          type="button"
          className="adm__act"
          // ★ 没有覆盖时它什么也不会做（点了等于白点），所以禁用而不是让它静默无效
          disabled={busy || !hasOverride}
          title={hasOverride ? undefined : '这一行现在用的就是 .env.local，没有可恢复的'}
          onClick={() => void reset()}
        >
          恢复默认
        </button>
      </div>

      {note ? (
        <p className="adm__model-note" data-bad={note.bad ? 'true' : undefined} role="status">
          {note.text}
        </p>
      ) : null}
    </article>
  )
}

/** 这一节现在的接口地址（认「厂商 / 网关」用）。没有「接口地址」那一格的能力就是空串 */
function baseUrlOf(section: SectionView): string {
  return section.fields.find((field) => field.id === 'baseUrl')?.value ?? ''
}

function draftsOf(section: SectionView): Record<FieldId, string> {
  const draft: Record<FieldId, string> = { model: '', baseUrl: '', apiKey: '', voice: '' }
  for (const field of section.fields) {
    // ★ 秘密那一格**不填**：值根本不在这一份数据里（`value` 是 null），
    //   所以这里什么也不做就是对的
    draft[field.id] = field.secret ? '' : (field.value ?? '')
  }
  return draft
}

export default function ModelConfig({ initial }: { initial: ModelConfigView }) {
  const [view, setView] = useState<ModelConfigView>(initial)

  return (
    <Fold
      id="adm-models"
      storageKey="adm.fold.models"
      title="模型配置"
      className="adm__models"
      extra={
        /* ★ 这句话要写出来：改完**不用重启**，而"配置改动要重启才生效"
            是所有人的默认预期——不写的话，站长会去做一次没必要的重启 */
        <span className="adm__model-tip">
          改完立刻生效，不用重启；正在生成的那一本用的还是旧配置
        </span>
      }
    >
      {view.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          effective={view.effective[effectiveKeyOf(section.id)]}
          onView={setView}
        />
      ))}

      {/* ★ 文件路径要露出来：手改、备份、换服务器都靠这条线索。
          它不是秘密（秘密是文件里的 key，而那些一个字节都没到这一页上） */}
      <p className="adm__models-file">
        这份配置写在 <code>{view.file}</code>
        （不在仓库里）。要手改也行，改完同样立刻生效。
      </p>
    </Fold>
  )
}

/**
 * `describeProviders` 那四句的键。
 * ★ 只有语音对不上：能力叫 `speech`（与权限那四个开关一致），
 *   而引擎那一句叫 `voice`（它说的是"这本书有没有朗读"）。
 *   这个映射必须写在明处——写成 `view.effective[section.id]` 的话，
 *   语音那一行会永远显示"（引擎没说这一项）"，而它看起来像个正常的状态。
 */
function effectiveKeyOf(id: SectionView['id']): string {
  return id === 'speech' ? 'voice' : id
}
