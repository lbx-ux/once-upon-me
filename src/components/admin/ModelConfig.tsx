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
 */

import { useCallback, useEffect, useState } from 'react'

import { clearModelConfig, fetchModelCandidates, saveModelConfig } from '@/lib/admin/client.ts'
import type {
  FieldId,
  ModelCandidates,
  ModelConfigView,
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

  /* ── 「模型名」那一格的候选（2026-10-17）─────────────────────────────────
   * 站长问的是「不是输入地址，就可以获取模型列表了吗」——能，列表就是
   * `{接口地址}/models` 那一份（`lib/settings/model-list.ts`）。
   *
   * ★ 它是 `datalist`，**不是**下拉选择框：这个网关的 `/models` 只列对话模型，
   *   图像在用的 `wan2.7-image` **不在**那 25 个里——做成强制选择的话，
   *   图像那一格会当场丢掉它正在用的值。候选只是候选，手填照旧。
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
      if (fresh) setDraft(draftsOf(fresh))
      setNote({ text: `${section.label}：改好了，下一次生成开始用新的`, bad: false })
      // ★ 地址可能刚被改掉，候选得跟着重拉一次（见上面 `pull` 那段）
      void pull()
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
      if (fresh) setDraft(draftsOf(fresh))
      setNote({ text: `${section.label}：回到环境变量那一份了`, bad: false })
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
          <span className="adm__model-hint">{section.hint}</span>
        </h3>
        {/* ★ 引擎自己那一句（文件头第 1 条） */}
        <p className="adm__model-live" title="引擎读到的配置，不是这一页拼的">
          {effective ?? '（引擎没说这一项）'}
        </p>
      </header>

      <div className="adm__model-fields">
        {section.fields.map((field) => (
          <label className="adm__model-field" key={field.id}>
            <span className="adm__model-label">
              {field.label}
              <span className="adm__model-source" data-src={field.source ?? 'none'}>
                {sourceLabel(field)}
              </span>
            </span>
            <input
              // ★ 秘密那一格用 password：站长输 key 的时候旁边可能有人
              type={field.secret ? 'password' : 'text'}
              value={draft[field.id]}
              autoComplete="off"
              spellCheck={false}
              // ★ 「模型名」那一格挂候选（见上面 `pull` 那段）。`list` 只影响
              //   浏览器的建议列表，**不影响能不能手填**——值仍然是自由的字符串
              {...(field.id === 'model' ? { list: `${section.id}-models` } : {})}
              placeholder={
                field.secret
                  ? field.configured
                    ? '已配置，留空表示不改'
                    : '还没配，粘一个进来'
                  : field.configured
                    ? '留空表示不改'
                    : '还没配'
              }
              onChange={(event) => setDraft((all) => ({ ...all, [field.id]: event.target.value }))}
            />
            {field.id === 'model' ? (
              <datalist id={`${section.id}-models`}>
                {(candidates?.ids ?? []).map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            ) : null}
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
              ? `${section.label}：从接口地址拉到 ${candidates.ids.length} 个模型候选（点「模型名」那一格就能选，也可以自己填）`
              : candidates.message}
        {candidates?.ok ? <code>{candidates.endpoint}</code> : null}
        {/* 改完地址要能重拉：不重拉的话，换了地址之后候选还是旧那家的 */}
        <button
          type="button"
          className="adm__act"
          disabled={pulling}
          title="按现在生效的接口地址再拉一次（改完地址要先保存）"
          onClick={() => void pull()}
        >
          重新拉取
        </button>
      </p>

      {section.warn ? <p className="adm__model-warn">{section.warn}</p> : null}

      <div className="adm__model-actions">
        <button
          type="button"
          className="adm__req-go"
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
