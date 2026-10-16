'use client'

/**
 * GenerationSetupDialog —— 「这一本要怎么做」（工单 04）
 *
 * `/home` 上点「开始创作」之后浮出来的那一个：**页数**四档 + **要不要朗读**。
 * 确认之后 `/create` 就开始跑——所以这两件事必须在**跑之前**问完，
 * 跑起来再问就等于让用户等两次。
 *
 * 四条判断：
 *
 * 1. **页数给四档，不给一个数字输入框**。生成一本书的成本与时间跟页数近乎线性
 *    （`illustrate.ts` 里那次实测：一次出图尝试 ≈154 s），所以"我要 17 页"不是一个
 *    该被支持的输入——它只会让人对着一个转很久的圈后悔。四档各自是一个**能承诺的规模**。
 * 2. ★ **音色只显示，不在这里改**。它写的是 `settings.speech.voice`——那**唯一一份**，
 *    而 `/home` 那颗声音药丸已经是它的下拉。在这里再摆一个下拉就是两个下拉写同一个值
 *    （`CreateLanding` 文件头那条"一个值只有一个家"）。要改，关掉这个弹窗去那颗药丸改。
 * 3. ★ **缺语音能力时开关是禁用的，而且点它会打开设置**——不是报一句错就完。
 *    缺的东西在哪里就把哪里打开（`CreateLanding.optimize()`、`CreateFlow` 那颗
 *    「打开模型与密钥」都是这条）。**绝不静默降级成不配音**：那会让人以为自己开了朗读，
 *    而书里没有声音。
 * 4. **Esc 关、点遮罩关、焦点进去、关掉后回原处**——与 `CreateLanding` 那两个下拉、
 *    `SettingsDrawer` 同一套习惯，不另发明一套。
 */

import { useState } from 'react'

import { DEFAULT_PAGES, PAGE_CHOICES } from '@/lib/creation/state.ts'
import { useSettings } from '@/components/settings/SettingsProvider.tsx'
// 模态的壳（遮罩 / Esc / 焦点 / 面板）在 `components/dialog/`：运行视图上那两个
// 弹窗用的是同一份，三个模态的关闭规矩必须一模一样
import Dialog from '@/components/dialog/Dialog.tsx'

export type SetupChoice = {
  pages: number
  /** `undefined` = 这一本不配音。★ 与"空串"不是一回事（见 `book-api.ts` 的 `voiceId`） */
  voiceId?: string
}

export type GenerationSetupDialogProps = {
  /** 弹窗里把那句话再念一遍：确认之前要能看见自己做的是什么 */
  wish: string
  onCancel: () => void
  onConfirm: (choice: SetupChoice) => void
  /** 确认之后正在跳走。它只是防连点，不改文案——跳页很快，改文案反而闪 */
  busy?: boolean
}

export default function GenerationSetupDialog({
  wish,
  onCancel,
  onConfirm,
  busy = false,
}: GenerationSetupDialogProps) {
  const { settings, voices, canNarrate, openSettings } = useSettings()
  const [pages, setPages] = useState<number>(DEFAULT_PAGES)
  /**
   * 「要不要朗读」是**这一本**的属性（进请求体的 `voiceId`），不是设置项——
   * 所以它住在这里，默认跟着"现在能不能朗读"走。
   *
   * ★ `null` = **还没动过它**，此时跟着 `canNarrate` 走。写成一个布尔初值
   *   （`useState(canNarrate)`）会把**那一刻**的读数钉死，而那个读数可能还没到位：
   *   设置是挂载之后才从 `localStorage` 读回来的（`SettingsProvider` 文件头第 2 条，
   *   直接读当初值会 hydration 不一致）。钉死之后，一个配好了语音的人在开关上
   *   看到的是"关"——那正是这条判断唯一要说清楚的事。
   * ★ 它**不是** `settings.speech.voice` 的副本：那个值（用哪一个）从头到尾只有一份。
   */
  const [voiceChoice, setVoiceChoice] = useState<boolean | null>(null)
  const voiceOn = voiceChoice ?? canNarrate

  const voiceName = voices.find((item) => item.id === settings.speech.voice)?.name ?? ''

  return (
    <Dialog
      title="这一本要怎么做"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="dlg__ghost" onClick={onCancel}>
            再改改故事
          </button>
          <button
            type="button"
            className="dlg__go"
            disabled={busy}
            onClick={() =>
              onConfirm({
                pages,
                // ★ 关掉朗读时**这个字段根本不传**——不是传一个空串
                //   （`book-api.ts` 的 `voiceId` 那段：引擎那边"没填"与"填了个空的"
                //    是两件事，后者会带着一个空音色去要 TTS）
                // ★ `canNarrate` 为真就**一定**有音色：`speechReady` 要求
                //   key + 模型 + 音色三样都在（`settings/state.ts`）。所以这里不再
                //   另判一次"音色是不是空的"——那种写法会造出一条**静默降级**的路：
                //   开关开着、书里却没有声音，而屏幕上没有任何东西说过这件事
                ...(voiceOn && canNarrate ? { voiceId: settings.speech.voice } : {}),
              })
            }
          >
            开始创作
          </button>
        </>
      }
    >
      <p className="gsd__wish">「{wish}」</p>

      <fieldset className="gsd__group">
        <legend className="gsd__label">这一本做多少页</legend>
        <div className="gsd__chips">
          {PAGE_CHOICES.map((count) => (
            <button
              key={count}
              type="button"
              className="gsd__chip"
              // ★ `aria-pressed` 而不是 radio：与仓库既有的分段控件一套
              //   （`CreateLanding` 的 `.cl__form`、`fields.tsx` 的 `Chip` 都是它）
              aria-pressed={pages === count}
              onClick={() => setPages(count)}
            >
              {count} 页
            </button>
          ))}
        </div>
        <p className="dlg__hint">
          页数越多越久。一次出图 + 一次核对大约一两分钟，所以 5 页是「看一眼」、 20
          页是「认真做一本」。
        </p>
      </fieldset>

      <fieldset className="gsd__group">
        <legend className="gsd__label">要不要朗读</legend>
        <div className="gsd__switch-row">
          <span className="gsd__switch-text">
            {voiceOn ? '这一本会配上朗读' : '这一本不配音（只有画和文字）'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={voiceOn && canNarrate}
            aria-label="要不要朗读"
            className="gsd__switch"
            // ★ 缺语音能力时禁用（判断 3）。**但它不是死的另一颗按钮**：
            //   点下去打开设置——所以用 `aria-disabled` 而不是 `disabled`，
            //   真 `disabled` 的按钮收不到点击，那条路就断了
            aria-disabled={!canNarrate}
            data-off={!canNarrate ? 'true' : undefined}
            onClick={() => {
              if (!canNarrate) {
                openSettings()
                return
              }
              setVoiceChoice(!voiceOn)
            }}
          >
            <span className="gsd__knob" aria-hidden="true" />
          </button>
        </div>
        {canNarrate ? (
          <p className="dlg__hint">
            {voiceName ? `用「${voiceName}」念。` : '还没选过音色，用的是默认那一个。'}
            要换音色就关掉这个窗口，在首页那颗声音上改——那里是**唯一**一处选音色的地方。
          </p>
        ) : (
          <p className="dlg__hint dlg__hint--warn">
            语音的模型或 Key 还没配齐，所以现在做不出朗读。
            <button type="button" className="dlg__link" onClick={openSettings}>
              点这里去配
            </button>
            {/* ★ 这句话是判断 3 的兑现处：说清"现在点不动"，并给出唯一能解决它的地方 */}
          </p>
        )}
      </fieldset>
    </Dialog>
  )
}
