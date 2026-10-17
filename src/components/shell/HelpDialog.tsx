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
 *   2. 没有权限怎么办 → **就在这里点一下发出去**（`RequestForm`）
 *   3. 为什么看不到别人做的书（★ 2026-10-17 工单 16 之后**反过来了**：
 *      以前答案是"作品没按账号分开"，现在是"分开了，你只看得到自己那一片"）
 *   4. 数据在哪儿、能不能带走（服务器只租 6 个月这件事，对用户是实话）
 *
 * ★ **2026-10-17 第二次改**：第 2 件原来是"发邮件到 2953997419@qq.com"，
 *   用户说「帮助这有一个发送请求，点击发送请求之后，就可以向管理者申请权限了，
 *   然后管理端就接收到申请，这也比发邮件好一点」。邮件那条路缺的不是"能不能送到"，
 *   是**站长那边认不出人**——所以常规路径改成点一下，邮箱留着，但降级成
 *   "申请被拒之后想问一句为什么"那一种情况才用得上。
 *
 * ★ 复用 `Dialog` 那个壳（Esc、点遮罩关、焦点进来、`aria-modal`）：
 *   另写一个浮层就会多一套"怎么关"的习惯，而它们必须一模一样。
 *
 * ★ **这里面不许出现 Markdown 的星号**：JSX 里的文字是普通文本，
 *   写 `**粗体**` 出来就是两个字面的星号。2026-10-17 实测撞上过一次
 *   （下面两处，浏览器里读到的就是 `开通**不用重新登录**`），
 *   `AdminScreen` 也撞过同一次——要强调就用 `<b>`，星号只在 `.md` 文件里成立。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

import Dialog from '@/components/dialog/Dialog.tsx'
import { fetchMine, submitRequest } from '@/lib/requests/client.ts'
import type { PermissionRequestRow } from '@/lib/requests/state.ts'
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
            就在下面写一句你要做什么，点「发出去」。站长在那一头看得见<b>是谁</b>提的。 四项能力是
            <b>一起开通</b>的，不用挑；开通也<b>不用重新登录</b>， 下一次点「开始创作」就生效。
          </p>
          <RequestForm />
        </section>

        <section className="help__item">
          <h3 className="help__q">为什么看不到别人的书？</h3>
          <p className="help__a">
            因为绘本、角色卡与孩子档案都是<b>按账号分开存的</b>：
            书架、角色墙、创作页上只有你自己做的那些，换一台设备登录看到的也是同一批。
            （首页那两个孩子是随仓库发布的<b>示例</b>，那一份谁都能看到。）
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
          {/* ★ 邮箱降级到这一句：它是"还有别的问题"那一条，不再是开通权限的常规路径。
              留着是因为申请被拒之后想问一句为什么，那件事不适合走一个只会回
              「已拒绝」的按钮 */}
          还有别的问题？写信到{' '}
          <a className="help__mail" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          ，或者去{' '}
          <Link className="help__link" href="/booklist" onClick={onClose}>
            灵感书单
          </Link>{' '}
          看看别人做出来的样子。
        </p>
      </div>
    </Dialog>
  )
}

/**
 * 那一条申请。打开弹窗时先查「我那条还在不在」，再决定显示表单还是显示"等着呢"。
 *
 * ★ 三种状态必须是**三个不同的画面**：
 *   · 有一条待处理的 → 一句"已经提过了，等站长处理"，**不给提交按钮**。
 *     给了的话，一个人会连着提三次；而服务端虽然会把它们并成一条，
 *     界面上仍然是"我提了三次、每次都说没成功过"。
 *   · 没有 → 表单。
 *   · 没查到（没登录、后端连不上）→ 一句实话 + 表单照常，但**绝不说"你还没申请过"**。
 *     ★ 那一句在这个分支里是假的，而它会让人再提一次——这正是上面那一格要防的事。
 *
 * ★ 四个勾选项**一律从"全不勾"开始**，不预置。
 *   曾经想预置成"他还没有的那几项"，但那需要这个弹窗知道这个人手里有什么，
 *   而工作台上**没有**一处会话上下文（`AppShell` 只渲染这个弹窗，不传用户）。
 *   为了一个预置去加一层 context，代价比它省下的那一次点击大。
 *   ★ 也正因为全不勾，那个提交按钮在一个人都没勾时是禁用的——
 *   服务端会用 `asks-for-nothing` 挡住它，但让按钮先一步不可按，
 *   省掉的是"点一下、等一个来回、被拒"。
 */
function RequestForm() {
  /**
   * 三态，所以类型里有三个值：
   * · `undefined` —— 还没查完（画面照常给表单，查完若真有一条再换成那句话）
   * · `null`      —— 查过了，**没有**待处理的
   * · 一行        —— 有一条待处理的，显示"等着呢"，不给提交按钮
   * ★ 不能用 `undefined` 同时表示"还没查"与"没有"：那样查完之后没有申请的人
   *   会停在"还没查"的画面上，而这个界面里那两态的差别正是"要不要给他表单"。
   */
  const [mine, setMine] = useState<PermissionRequestRow | null | undefined>(undefined)
  const [unreadable, setUnreadable] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; bad: boolean } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const verdict = await fetchMine()
      if (!alive) return
      // ★ 只做一件事：**有没有一条待处理的**。查得成就照实显示，
      //   查不成就说查不成——**绝不把"查不到"当成"没申请过"**（见下面那句 warn）
      if (verdict.ok) setMine(verdict.data)
      else setUnreadable(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  if (mine) {
    return (
      <p className="help__waiting" role="status">
        你已经提过一条了，站长那一头看得见。
        {/* ★ 说"这条还要等"而不是"很快就好"：这一头的处理时间不是这个界面能承诺的 */}
        <span className="help__waiting-sub">
          开通是四项一起给的，处理完不用重新登录，下一次点「开始创作」就生效。
        </span>
      </p>
    )
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    const verdict = await submitRequest(note.trim())
    if (verdict.ok) {
      setMine(verdict.data)
      setResult(null)
    } else {
      setResult({ text: verdict.message, bad: true })
    }
    setBusy(false)
  }

  return (
    <form className="help__req" onSubmit={(event) => void send(event)}>
      {unreadable ? (
        // ★ 这一句不能省：没查到与"没有过申请"长得一样，而前者下面那个表单
        //   可能正在**改**一条已经存在的申请
        <p className="help__req-warn">暂时读不到你之前的申请（不影响下面这个表单）。</p>
      ) : null}

      <input
        className="help__req-note"
        type="text"
        value={note}
        maxLength={500}
        placeholder="想用来做什么（可填可不填，写了更容易批）"
        onChange={(event) => setNote(event.target.value)}
      />

      {/* ★ 提交按钮**不再有"至少勾一项"那个前提**：不必勾任何东西就能提。
          原来那句提示（「至少勾一项——一样都没勾的话，批了等于什么都没发生」）
          跟着复选框一起撤了，因为它要挡的那个情形（一样都没勾）
          在申请一律四项之后已经不存在了 */}
      <button type="submit" className="help__req-go" disabled={busy}>
        {busy ? '在发…' : '发出去'}
      </button>

      <p className="help__req-hintline">开通是四项一起给的，不用挑。</p>

      {result ? (
        <p className="help__req-bad" role="alert">
          {result.text}
        </p>
      ) : null}
    </form>
  )
}
