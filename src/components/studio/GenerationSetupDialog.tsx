'use client'

/**
 * GenerationSetupDialog —— 「这一本要怎么做」（工单 04 / 06）
 *
 * `/home` 上点「开始创作」之后浮出来的那一个：形态 + 页数四档 + 要不要朗读。
 * 确认之后 `/create` 就开始跑——所以这三件事必须在跑之前问完，
 * 跑起来再问就等于让用户等两次。
 *
 * 五条判断：
 *
 * 1. ★ 形态是这里的第一问（2026-10-18 搬进来）。它原来站在 `/home` 标题上方
 *    那一行（`.cl__forms`，两颗按钮、共读版那颗真 `disabled` 写着「还没做」）。
 *    用户这一轮把那一行整个撤了，理由不是"少一个控件"：形态换的是这一本怎么做，
 *    那和"几页""要不要朗读"是同一类问题，同一个问题的三问摆在两处，
 *    人就得多想一次"我该在哪儿定这件事"。
 *    ★ 那里预登记过一条代价（`create-landing.css` 原来那段：这一屏不解释
 *      "独读版/共读版"是什么意思，"共读版真能选的那一天必须补一行说明"）。
 *      说明补上了，当天又被用户划掉——他看到弹窗的截图，把三处说明（形态、
 *      页数、音色）一并划了。所以这一版一格解释都没有，控件自己说完。
 *      这条推翻上一条的理由不是"用户随口说的"：这一屏每一组都只有一行控件，
 *        说明比控件还长的时候，人读的是说明、选的是控件，而这两个词的含义
 *        本来也不在弹窗里才成立（GLOSSARY §语言 是它的家）。
 *      ★ 代价如实记下：第一次来的人看到"独读版 / 共读版"两个词，
 *        界面上没有任何地方告诉他差别——只能各做一本试试。共读版比独读版
 *        多画的那一支、页数是"路长"这件口径，界面上一概不说（确切张数本来就该在
 *        故事闸门那一屏给，见工单 05；那里现在是空的）。
 *    选中态跟着这一屏的既有语言走（`.gsd__chip`：accent 边 + 淡底 + accent 字），
 *      没有把那两颗的"只有四周变蓝、中间不变"一起搬进来。那一句是给**压在天空带上
 *      的白胶囊**定的（白底是它的对比度安全区），搬进一块已经是白的面板之后，
 *      它只剩"与同面板里另一排长得不一样"这一件事。`globals.css` 的 `--select`
 *      那段记的是同一个决定。
 * 2. 页数给四档，不给一个数字输入框。生成一本书的成本与时间跟页数近乎线性
 *    （`illustrate.ts` 里那次实测：一次出图尝试 ≈154 s），所以"我要 17 页"不是一个
 *    该被支持的输入——它只会让人对着一个转很久的圈后悔。四档各自是一个能承诺的规模。
 *    共读版那一档说的是这条路读下来多少页（路长），不是全树节点数——
 *      这句话 2026-10-18 之前写在下面那行说明里，说明划掉之后它就只剩代码里这一处。
 *      要么在闸门那一屏补上（工单 05 的 §三），要么这一档对共读版就是没说清。
 * 3. ★ 音色只显示，不在这里改。它写的是 `settings.speech.voice`——那唯一一份，
 *    而 `/home` 那颗声音药丸已经是它的下拉。在这里再摆一个下拉就是两个下拉写同一个值
 *    （`CreateLanding` 文件头那条"一个值只有一个家"）。要改，关掉这个弹窗去那颗药丸改。
 *    那句"要换音色就关掉这个窗口去首页改"的提示 2026-10-18 随另外两处说明一起划掉了：
 *      判断没变（音色仍然只在那颗药丸上改），变的是说不说——用哪个音色那颗药丸上
 *      就写着，弹窗里再说一遍是重复。代价：在这里找不到"去哪儿改"的那一句话。
 * 4. ★ 缺语音能力时开关是真 `disabled`，而且那句说明要说清缺的是哪一样——
 *    不是报一句错就完，也绝不静默降级成不配音：那会让人以为自己开了朗读，
 *    而书里没有声音。2026-10-17 之前它是"点下去打开设置"，那个抽屉已经没有了
 *    （密钥由站长分配），见下面那颗开关自己的注释。
 * 5. Esc 关、点遮罩关、焦点进去、关掉后回原处——与 `CreateLanding` 那两个下拉、
 *    `SettingsDrawer` 同一套习惯，不另发明一套。
 */

import { useState } from 'react'

// 领域常量走 `domain.ts`，不走 `engine/index.ts`——后者会把 providers 与 `node:fs`
//   一起拖进浏览器 bundle（那条 `no-restricted-imports` 的判据就在 eslint 配置里）
import { BOOK_FORMS, FORM_LABELS, type BookForm } from '@/lib/engine/domain.ts'
import { DEFAULT_PAGES, PAGE_CHOICES } from '@/lib/creation/state.ts'
import { useVoice } from '@/components/voices/VoiceProvider.tsx'
import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { NARRATION_BLOCK_MESSAGE } from '@/lib/voices/state.ts'
import { canCreate } from '@/lib/auth/state.ts'
// 模态的壳（遮罩 / Esc / 焦点 / 面板）在 `components/dialog/`：运行视图上那两个
// 弹窗用的是同一份，三个模态的关闭规矩必须一模一样
import Dialog from '@/components/dialog/Dialog.tsx'

export type SetupChoice = {
  /** `solo` = 独读版，`shared` = 共读版（GLOSSARY「形态」）。它进 URL 的 `form=` */
  form: BookForm
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
  const { current, canNarrate, narrateBlock } = useVoice()
  const { allowed: mayCreate, configured } = useAuth()
  /**
   * 第二道闸（工单 07 第 1 条）。第一道在 `CreateLanding` 那颗「开始创作」上，
   *   它拦的是"按下去的那一刻"。这一道拦的是这中间：弹窗已经开着的时候，
   *   站长在管理页把那个人的权限收回了——而他的弹窗还开着，
   *   再按一次「开始创作」就是拿着一个过期的判断往下走。
   *   两道都只是体验；真正管用的是 `/api/books` 那条 403。
   */
  const allowed = mayCreate && canCreate(configured)
  /**
   * 形态。★ 默认独读版——它是产品的默认（睡前那一档），也是这个弹窗第一次浮出来时
   * 唯一一个"不选也能往下走"的值。
   */
  const [form, setForm] = useState<BookForm>('solo')
  const [pages, setPages] = useState<number>(DEFAULT_PAGES)
  /**
   * 「要不要朗读」是这一本的属性（进请求体的 `voiceId`），不是设置项——
   * 所以它住在这里，默认跟着"现在能不能朗读"走。
   *
   * `null` = 还没动过它，此时跟着 `canNarrate` 走。写成一个布尔初值
   *   （`useState(canNarrate)`）会把那一刻的读数钉死，而那个读数可能还没到位：
   *   设置是挂载之后才从 `localStorage` 读回来的（`SettingsProvider` 文件头第 2 条，
   *   直接读当初值会 hydration 不一致）。钉死之后，一个配好了语音的人在开关上
   *   看到的是"关"——那正是这条判断唯一要说清楚的事。
   * 它不是 `settings.speech.voice` 的副本：那个值（用哪一个）从头到尾只有一份。
   */
  const [voiceChoice, setVoiceChoice] = useState<boolean | null>(null)
  const voiceOn = voiceChoice ?? canNarrate

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
            /* 权限被收回时这颗钮是死的：让人按下去、再被告知"你不行"，
               比一开始就按不动更糟——他已经在心里把这一本做出来了 */
            disabled={busy || !allowed}
            /* 与 `CreateLanding` 那一句逐字一样（用户 2026-10-17：只写那一句、
               不写缺什么）。两处各写一份文案的代价是它们会开始不一样，
               所以这里连标点都不改。 */
            title={allowed ? undefined : '当前用户没有权限，请联系管理员'}
            onClick={() =>
              onConfirm({
                form,
                pages,
                // 关掉朗读时这个字段根本不传——不是传一个空串
                //   （`book-api.ts` 的 `voiceId` 那段：引擎那边"没填"与"填了个空的"
                //    是两件事，后者会带着一个空音色去要 TTS）
                // `canNarrate` 为真就一定有音色：`speechReady` 要求
                //   key + 模型 + 音色三样都在（`settings/state.ts`）。所以这里不再
                //   另判一次"音色是不是空的"——那种写法会造出一条静默降级的路：
                //   开关开着、书里却没有声音，而屏幕上没有任何东西说过这件事
                ...(voiceOn && canNarrate ? { voiceId: current } : {}),
              })
            }
          >
            开始创作
          </button>
        </>
      }
    >
      <p className="gsd__wish">「{wish}」</p>

      {/* 形态（判断 1）。★ 摆在最前面，因为**下面两问的意思跟着它变**：
          共读版的"几页"是路长，而两支各自收尾这件事也决定了这本书读起来是什么样。
          ★ 这里**没有解释那一行**（用户 2026-10-18 把三处说明全划掉了，见判断 1） */}
      <fieldset className="gsd__group">
        <legend className="gsd__label">这一本怎么读</legend>
        <div className="gsd__chips">
          {BOOK_FORMS.map((item) => (
            <button
              key={item}
              type="button"
              className="gsd__chip"
              aria-pressed={form === item}
              onClick={() => setForm(item)}
            >
              {FORM_LABELS[item]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="gsd__group">
        <legend className="gsd__label">这一本做多少页</legend>
        <div className="gsd__chips">
          {PAGE_CHOICES.map((count) => (
            <button
              key={count}
              type="button"
              className="gsd__chip"
              // `aria-pressed` 而不是 radio：与仓库既有的分段控件一套
              //   （`LoginPage` 那两颗「验证码 / 密码」、`fields.tsx` 的 `Chip` 都是它）
              aria-pressed={pages === count}
              onClick={() => setPages(count)}
            >
              {count} 页
            </button>
          ))}
        </div>
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
            /* 缺语音能力时按不动（判断 3）。★ 2026-10-17 起它是真 `disabled`：
               原来用的是 `aria-disabled` + "点下去打开设置"——而那个设置抽屉已经没有了
               （密钥由站长分配，用户在界面上一个 key 都填不了）。留着一颗"按下去开某个
               抽屉"的钮才是假的。理由改由下面那句 `dlg__hint` 完整说出来。 */
            disabled={!canNarrate}
            data-off={!canNarrate ? 'true' : undefined}
            onClick={() => setVoiceChoice(!voiceOn)}
          >
            <span className="gsd__knob" aria-hidden="true" />
          </button>
        </div>
        {canNarrate ? null : (
          /*
           * ★ 这句话是判断 4 的兑现处，而 2026-10-17 起它必须说清是哪一条：
           *   以前只有一种原因（"用户没填 key"），现在有三个，而它们对用户来说
           *   是三个不同的下一步——找站长开、等站里配好、还是自己去挑一个音色。
           *   `NARRATION_BLOCK_MESSAGE` 是这个映射唯一的一份（见 `voices/state.ts`）。
           * 能朗读那一支不再配说明（用户 2026-10-18 划掉了"用「灵灵」念。要换音色…"
           *   那一句）：用哪个音色在 `/home` 那颗药丸上就写着，这里再说一遍是重复。
           *   这一支剩下的字就是开关左边那句「这一本会配上朗读 / 不配音」。
           * ★ 而这一支必须留着：它说的是"为什么按不动"，不是"怎么用"——
           *   删了它就是静默降级成不配音（判断 4 的全部理由）。
           */
          <p className="dlg__hint dlg__hint--warn">
            {narrateBlock === 'no-voice' ? (
              <>
                还没挑音色，所以这一本做不出朗读。
                <a className="dlg__link" href="/voice">
                  去挑一个
                </a>
              </>
            ) : narrateBlock ? (
              NARRATION_BLOCK_MESSAGE[narrateBlock]
            ) : null}
          </p>
        )}
      </fieldset>
    </Dialog>
  )
}
