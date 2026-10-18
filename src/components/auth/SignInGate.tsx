'use client'

/**
 * auth/SignInGate.tsx —— 「这件事要登录」那道门（用户 2026-10-17 要的）
 *
 * 用户的原话：「没有登录就去创作，生成人物，生成声音，就出现一个弹窗，
 * 显示请登录，然后用户点击，就跳转到登录界面」。
 *
 * 所以三件事：
 *
 * 1. **点下去先问一句"你是谁"**（`ask()`），没登录就弹窗——**不**把点击放过去。
 *    ★ 现问一次而不是用渲染时那一份：cookie 可能在这中间过期（开了几天没动的标签页），
 *      而"渲染时是登录的"与"此刻是登录的"不是同一句话。
 *    ★ 问回来的那一份**顺带回给调用方**：`CreateLanding` 紧接着还要判权限，
 *      再问一次 `/api/auth/me` 是白跑一趟。
 *
 * 2. **弹窗里那颗钮把人送到 `/login`，并带上此刻这一页**（`?next=`）。
 *    登录完回到他刚才想动手的地方，而不是回首页重新找一遍。
 *    ★ `next` 的判据在 `lib/auth/state.ts` 的 `safeNext()`，这一层不自己判。
 *
 * 3. **它只管"有没有登录"，不管权限**。没权限是另一件事（那是登录之后的判断），
 *    两件事混在一个弹窗里，用户就分不清"我要去登录"还是"我要去找站长"。
 *
 * ★ 为什么做成一个 hook 而不是一个 `<RequireSignIn>` 包一层的组件：
 *   这三处要拦的是**一次点击**（按钮的 `onClick`），不是一屏的渲染。
 *   包一层组件只能拦"看不看得见"，拦不住"点得动"——而用户说的正是点下去那一下。
 *   代价是每个调用点多两行（`await gate.ask()` + 把 `gate.dialog` 放进树里）。
 */

import { useCallback, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

import Dialog from '@/components/dialog/Dialog.tsx'
import { useAuth } from '@/components/auth/AuthProvider.tsx'
import { safeNext, type Permissions } from '@/lib/auth/state.ts'

export type SignInVerdict =
  /** 已登录。★ 带回刚问到的"能不能创作"与"站里配齐了什么"，调用方不必再问一次 */
  | { kind: 'signed-in'; allowed: boolean; configured: Permissions }
  /** 没登录（弹窗已经开了） */
  | { kind: 'signed-out' }

export function useSignInGate(): { ask: () => Promise<SignInVerdict>; dialog: ReactNode } {
  const { refresh } = useAuth()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const ask = useCallback(async (): Promise<SignInVerdict> => {
    const fresh = await refresh()
    if (fresh) return { kind: 'signed-in', ...fresh }
    setOpen(true)
    return { kind: 'signed-out' }
  }, [refresh])

  /**
   * 回哪儿去。★ 用 `safeNext` 判一次：这一路只是"此刻这一页"，
   * 但它会被拼进一个 URL 再被读出来，所以哪怕来源可信也过一道。
   */
  const next = safeNext(pathname) ?? '/'

  const dialog = open ? (
    <Dialog
      title="请先登录"
      onClose={() => setOpen(false)}
      width={420}
      footer={
        <>
          <button type="button" className="dlg__ghost" onClick={() => setOpen(false)}>
            再看看
          </button>
          {/* ★ 是一颗 `<a href>` 而不是 `router.push`：登录是一**次导航去另一屏**，
              它要能中键新标签页打开、要能出现在地址栏的历史里。
              用 `push` 的话这两件事都没了，而它看起来完全一样。 */}
          <a className="dlg__go" href={`/login?next=${encodeURIComponent(next)}`}>
            去登录
          </a>
        </>
      }
    >
      <p className="sg__text">
        创作、做角色卡、录声音都需要一个账号——登录之后才能把东西存下来，
        也才有地方放下你做过的那些书。
      </p>
      <p className="sg__hint">用手机号收一次验证码，或者直接用密码登录。</p>
    </Dialog>
  ) : null

  return { ask, dialog }
}
