'use client'

/**
 * SettingsDialog —— 侧栏底部那一格「设置」点开的东西（用户 2026-10-17 要的）
 *
 * 现在里面四节：阅读偏好（独读版翻页交给谁）、共读版（同一件事，
 *   共读版那一档，2026-10-20 用户要的）、手机横屏提示（2026-10-19）与
 *   阅读器背景（书底下铺哪一张，2026-10-18 用户要的）。
 *   他当时的原话是"点开设置是阅读偏好"，所以第一版就只做了那一节
 *   ——不为"将来可能还有别的"先搭一排空的格子。多一条偏好就多一节，`<section>`
 *   直接往下排（`settings-dialog.css` 那个 grid 就是为此写的间距），现在正是它兑现的时候。
 *
 * 复用 `Dialog` 那个壳（Esc、点遮罩关、焦点进来、`aria-modal`、`aria-labelledby`）：
 *   另写一个浮层就会多一套"怎么关"的习惯，而两个浮层必须一模一样
 *   （理由写在 `Dialog.tsx` 的文件头——那一份是这道纪律唯一的出处；
 *   原来还并列着一份在 `HelpDialog.tsx`，那个弹窗 2026-10-18 拆掉了）。
 *
 * 没有"保存"按钮，改一下即时生效、即时落盘。一个只有两个单选的选择，
 *   读完还要记得按一下保存，多出来的那一步只会制造"我到底存上了没有"的疑问。
 *   底栏那颗「知道了」是关窗，不是提交——所以它写成"知道了"而不是"保存"。
 *   底图那一节也一样：选完要回到阅读器那一屏才看得见（那是另一条路由），
 *     所以它的小字里写了这一句。它不是一个"没生效"的疑问，是一句下一步。
 *
 * 弹窗里只有每节那一行小字（"读独读版…时，翻页这件事交给谁"）。原本阅读偏好
 *   下面还有两句注解，2026-10-17 用户看着截图圈掉了一整块（原话：「下面画圈的这句话不要了」）：
 *
 *   · 「只有整本书每一页都录了朗读时才生效」——这一条现在由阅读器自己说：
 *     碰到半本有录音的书，那一屏的正文下面就写着"这本书只有 N/M 页有朗读，所以没有给
 *     朗读控件"。也就是说，它出现在真会撞上它的那一刻，而不是出现在一个大部分人
 *     用不到它的设置页里（与侧栏那几格"常驻的说明会被读成背景噪音"同一条判断；
 *     2026-10-18：「帮助」那一格自己也按这条判断走了——整格拆掉）。
 *   · 「这个选择只存在这台设备的这个浏览器里」——删掉之后界面上没有任何地方再说
 *     这件事了。它没有变成假的（`lib/reading-prefs.ts` 与 `lib/reader-paper.ts` 仍然
 *     只写 `localStorage`，换设备还是要重选），但看不见了：这一条留在 docs/known-tradeoffs.md
 *     与那两个文件的文件头里，是给接手的人看的，不是给用户看的。
 *     ★ 底图那一节不把这句话加回来：那不是"补上漏掉的说明"，
 *       是把用户亲手圈掉的东西换个地方再写一遍。
 *
 * 单选两颗不自己画：原生 radio 在三个浏览器里都认得出来、带回焦点环、
 *   带高对比度，自己画一颗要连带管这一整套。与「帮助」里那个复选框同一条纪律。
 *   底图那七行同样用原生 radio——画的是旁边那格缩略图，不是那颗钮。
 */

import Dialog from '@/components/dialog/Dialog.tsx'
import { READER_PAPERS } from '@/lib/reader-paper.ts'
import {
  useReaderPaper,
  useRotateHint,
  useSharedTurnMode,
  useTurnMode,
} from '@/lib/use-reading-prefs.ts'

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { turnMode, setTurnMode } = useTurnMode()
  const { turnMode: sharedTurnMode, setTurnMode: setSharedTurnMode } = useSharedTurnMode()
  const { paper, setPaper } = useReaderPaper()
  const { rotateHint, setRotateHint } = useRotateHint()

  return (
    <Dialog
      title="设置"
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="dlg__go" onClick={onClose}>
          知道了
        </button>
      }
    >
      <section className="prefs">
        <h3 className="prefs__title">阅读偏好</h3>
        <p className="prefs__lead">
          读<b>独读版</b>（一页一图一句的那种）时，翻页这件事交给谁。
        </p>

        <fieldset className="prefs__opts">
          {/* 读屏要能念出"这一组是在选什么"。视觉上那行小字（`.prefs__lead`）
              已经说了，所以这里只在辅助技术里念 */}
          <legend className="sr-only">翻页方式</legend>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-turn-mode"
              value="manual"
              checked={turnMode === 'manual'}
              onChange={() => setTurnMode('manual')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">我自己翻</span>
              <span className="prefs__opt-note">
                想听就点「朗读」，它只念当前这一页，念完就停，页由你翻。
              </span>
            </span>
          </label>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-turn-mode"
              value="auto"
              checked={turnMode === 'auto'}
              onChange={() => setTurnMode('auto')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">自动朗读</span>
              <span className="prefs__opt-note">
                在阅读器里按一次「自动朗读」，之后一页页自己念、念完自己翻；你翻页它就停下。
              </span>
            </span>
          </label>
        </fieldset>
      </section>

      {/* ── 共读版那一节（2026-10-20 加的一节） ─────────────────────────────
          ★ 与上一节**同形、不同档**：翻页交给谁这件事在两种形态里都问一遍，因为
            它们落两个键、各选各的（`lib/reading-prefs.ts` 的文件头写了为什么不是一条）。
            自动那一条的小字在这里多一句"读到选择点会停下来…"——那是共读版独有的一段路，
            写在两档共用的地方就等于对独读版说了一句它做不到的事。

          ★ 两颗 radio 的 `name` 必须与上一节**不同**：同名会把两组并成一组，
            症状是"点共读版那一颗，独读版那一颗灭了"。 */}
      <section className="prefs">
        <h3 className="prefs__title">共读版</h3>
        <p className="prefs__lead">
          读<b>共读版</b>（读到选择点、孩子选一条路的那种）时，翻页这件事交给谁。
        </p>

        <fieldset className="prefs__opts">
          <legend className="sr-only">共读版的翻页方式</legend>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-turn-mode-shared"
              value="manual"
              checked={sharedTurnMode === 'manual'}
              onChange={() => setSharedTurnMode('manual')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">我自己翻</span>
              <span className="prefs__opt-note">
                想听就点「朗读」，它只念当前这一页，念完就停，页由你翻。
              </span>
            </span>
          </label>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-turn-mode-shared"
              value="auto"
              checked={sharedTurnMode === 'auto'}
              onChange={() => setSharedTurnMode('auto')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">自动朗读</span>
              <span className="prefs__opt-note">
                在阅读器里按一次，一页页自己念、念完自己翻；读到选择点会停下来，
                把选项念给孩子听，选完接着念。
              </span>
            </span>
          </label>
        </fieldset>
      </section>

      {/* ── 第三节：手机横屏提示（2026-10-19 移动端适配） ─────────────────────
          ★ 这一节存在的**唯一理由**是让那层提示可关**也可再打开**：
            阅读器里那颗「仍然竖着看」是单向的（它只写 `off`），
            而一个只能关不能开的开关是个陷阱。所以改回来的入口在这里，
            与另外两条阅读偏好排在同一张纸上 —— 阅读器里那两句说明行
            （"想自己翻，到工作台左下角的「设置」里选…"）指的正是这一处。

          ★ 桌面上这一节**照样显示**，不做"手机上才出现"的分支：偏好是这台设备的，
            而人在桌面浏览器里也可能把窗口拉窄、或者用触屏笔记本。少一个分支，
            就少一处"为什么我这儿没有这一项"。 */}
      <section className="prefs">
        <h3 className="prefs__title">手机横屏提示</h3>
        <p className="prefs__lead">在手机上竖着翻开一本书时，要不要提示你把手机横过来。</p>

        <fieldset className="prefs__opts">
          <legend className="sr-only">手机横屏提示</legend>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-rotate-hint"
              value="ask"
              checked={rotateHint === 'ask'}
              onChange={() => setRotateHint('ask')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">提示我横过来</span>
              <span className="prefs__opt-note">
                竖屏翻开书时压一层提示；横过来之后书按屏幕高铺满，一页大得多。
              </span>
            </span>
          </label>

          <label className="prefs__opt">
            <input
              type="radio"
              name="reader-rotate-hint"
              value="off"
              checked={rotateHint === 'off'}
              onChange={() => setRotateHint('off')}
            />
            <span className="prefs__opt-body">
              <span className="prefs__opt-name">不提示</span>
              <span className="prefs__opt-note">直接看竖屏那一版。</span>
            </span>
          </label>
        </fieldset>
      </section>

      {/* ── 第二节：阅读器背景（2026-10-18） ────────────────────────────────
          用户的顺序是"多给几张、我在设置里挑"，所以这里**不替他挑**：
          七行平铺，第一行就是默认那一档（`READER_PAPERS` 的次序）。
          ★ 每行只有名字、没有说明文字：七行各写一句注解会变成一堵墙，
            而这一列的名字（暖纸/木桌/亚麻…）本来就是自解释的——
            真要一句话，那是缩略图那一格的活。 */}
      <section className="prefs">
        <h3 className="prefs__title">阅读器背景</h3>
        <p className="prefs__lead">
          读一本书时，书底下那一层铺什么。两台阅读器都跟着换，改完回到阅读器就是新的底。
        </p>

        <fieldset className="prefs__opts">
          <legend className="sr-only">阅读器背景</legend>

          {READER_PAPERS.map((option) => (
            <label className="prefs__opt prefs__opt--paper" key={option.key}>
              <input
                type="radio"
                name="reader-paper"
                value={option.key}
                checked={paper.key === option.key}
                onChange={() => setPaper(option.key)}
              />
              {/* 缩略图是**装饰**：这一行说的是名字，读屏念名字就够了。
                  `plain` 那一档没有图，露出来的就是 `.prefs__swatch` 的底色（`--bg`）
                  —— 那正是它在阅读器里的样子 */}
              <span
                className="prefs__swatch"
                aria-hidden="true"
                style={option.thumb ? { backgroundImage: `url(${option.thumb})` } : undefined}
              />
              <span className="prefs__opt-body">
                <span className="prefs__opt-name">{option.label}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
    </Dialog>
  )
}
