'use client'

/**
 * HelpDialog —— 侧栏底部那一格「帮助」点开的东西（用户 2026-10-17 要的）
 *
 * ★ 它替掉的是原来那一行**一直摊在侧栏上的说明**。用户的原话是
 *   「这句话不要明着写出来，左下角弄一个"帮助"的模块，然后用户点击，
 *   就出现一个弹窗，上面再写清楚」——所以这一份是那句说明的**新家**，
 *   内容不是删掉，是**收进一个要点一下才出现的地方**。
 *
 * ★ 为什么值得收起来：那一行在侧栏上永远占着三行（邮箱还会被折成两截，见
 *   `.shell__note` 那版实测的样子），而它要说的事对**大多数**人、**大多数**时候
 *   都不发生——只有真撞上"没有权限"或"想多要点额度"的那一刻才需要。
 *   常驻的说明会被读成背景噪音，真正需要它的人反而先扫过去。
 *
 * ★ 里面写四件事，每件都是"这个人下一步会问的问题"：
 *   1. 密钥/模型谁配的（不然他会去找输入框——而界面上一个都没有）
 *   2. 没有权限怎么办（找谁、怎么找）
 *   3. 为什么看不到别人做的书（作品是这台服务器上的，不是"你的账号里的"）
 *   4. 数据在哪儿、能不能带走（服务器只租 6 个月这件事，对用户是实话）
 *
 * ★ 复用 `Dialog` 那个壳（Esc、点遮罩关、焦点进来、`aria-modal`）：
 *   另写一个浮层就会多一套"怎么关"的习惯，而它们必须一模一样。
 *
 * ★ **这里面不许出现 Markdown 的星号**：JSX 里的文字是普通文本，
 *   写 `**粗体**` 出来就是两个字面的星号。2026-10-17 实测撞上过一次
 *   （下面两处，浏览器里读到的就是 `开通**不用重新登录**`），
 *   `AdminScreen` 也撞过同一次——要强调就用 `<b>`，星号只在 `.md` 文件里成立。
 */

import Link from 'next/link'

import Dialog from '@/components/dialog/Dialog.tsx'
import { CONTACT_EMAIL } from '@/lib/voices/state.ts'

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="帮助"
      onClose={onClose}
      width={520}
      footer={
        <button type="button" className="dlg__go" onClick={onClose}>
          知道了
        </button>
      }
    >
      <div className="help">
        <section className="help__item">
          <h3 className="help__q">模型和密钥是谁配的？</h3>
          <p className="help__a">
            由站方统一分配，不需要你填任何 key——界面上也没有填的地方。 你能不能用某一项能力（写故事
            / 画插画 / 核对面孔 / 朗读），由站长按账号分配。
          </p>
        </section>

        <section className="help__item">
          <h3 className="help__q">说我「没有权限」怎么办？</h3>
          <p className="help__a">
            找站长开。发邮件到{' '}
            <a className="help__mail" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            ，说明你要用的是哪一项、用来做什么；开通<b>不用重新登录</b>
            ，下一次点「开始创作」就生效。
          </p>
        </section>

        <section className="help__item">
          <h3 className="help__q">为什么看不到别人的书？</h3>
          <p className="help__a">
            这个站上的绘本与角色卡都放在<b>同一台服务器的一份磁盘</b>上，
            没有按账号分开。所以书架上是这台服务器做过的全部作品，
            而不是「只有你的」——换一台设备打开，看到的是同一批。
          </p>
        </section>

        <section className="help__item">
          <h3 className="help__q">我的东西存在哪？</h3>
          <p className="help__a">
            服务器上的一台机器里（这一轮不做账号级的导出）。 本站的服务器只租到 6
            个月，到期之前会把全部作品与账号数据备份回本地—— 这件事由站方做，不需要你操作。
          </p>
        </section>

        <p className="help__foot">
          还有别的问题？去{' '}
          <Link className="help__link" href="/booklist" onClick={onClose}>
            灵感书单
          </Link>{' '}
          看看别人做出来的样子，或者直接开始做一本。
        </p>
      </div>
    </Dialog>
  )
}
