'use client'

/**
 * AuthProvider —— 「现在是谁在用」这一份状态的家
 *
 * 与 `SettingsProvider` 同一层、同一套挂法：**挂在根 layout 上，不在各个页面里**。
 * 理由也一样：侧栏底部那一格、个人主页、以后任何"要看一眼是谁"的地方，
 * 读的必须是同一份状态；挂在页面里就会出现"两处各有一份、登出这边那边不知道"。
 *
 * ★ 三条判断：
 *
 * 1. **首屏一律按"未登录"渲染**，挂载后才把本机存的那份读回来。
 *    直接拿 localStorage 当初值会 hydration 不一致——这条学费 `AppShell` 的折叠状态
 *    已经付过一次（那个文件头第 1 条），这里不重付。
 *
 * 2. ★ **代价要说清楚：会闪一下。** 已登录的人刷新 `/home`，侧栏那一格先是
 *    「请登录」、后是「个人主页」。它比折叠状态那次轻——两副面孔的外框、图标格、
 *    行高完全一样，变的只是图标形状与两四个字，而且这一下在 hydration 后
 *    同一帧内发生。`ready` 因此**露出去**，让需要更讲究的读者自己决定怎么用
 *    （比如先占住位置）。★ 等后端落地，这件事会自然消失：那时候身份在**服务端**的
 *    session cookie 里，服务端第一次就渲染对了，根本没有"两张面孔"。
 *
 * 3. **写账号只走 `lib/auth/client.ts`**（改昵称也是）。理由写在那边的
 *    `updateNickname` 上：漏掉一处 `fetch` 的症状是"改了但没存"，它不报错。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { updateNickname } from '@/lib/auth/client.ts'
import { clearUser, loadUser, saveUser, type AuthUser } from '@/lib/auth/state.ts'

export type AuthContextValue = {
  user: AuthUser | null
  /** 本机那份读完了吗（见文件头第 2 条）。★ 未读完时不要用它做"要不要显示"的判据 */
  ready: boolean
  /** 登录成功：写进本机 + 更新内存。调用方拿到 `AuthUser` 之后调它 */
  signIn: (user: AuthUser) => void
  /**
   * 退出登录。★ 只清"这个人是谁"，**不动那张在册号码表**——
   * 那张表是"哪些号码设过密码"这件事实，登出不该把它忘掉（忘了就再也走不了密码登录）。
   */
  signOut: () => void
  /** 改昵称。失败时抛（`client.ts` 只会因为网络失败而抛，模拟不会） */
  rename: (nickname: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 必须在 <AuthProvider> 里用')
  return value
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  // ★ 初值是 null（服务端也渲染得出来），挂载后再读本机那份
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setUser(loadUser())
    setReady(true)
  }, [])

  const signIn = useCallback((next: AuthUser) => {
    saveUser(next)
    setUser(next)
  }, [])

  const signOut = useCallback(() => {
    clearUser()
    setUser(null)
  }, [])

  /**
   * ★ `rename` 要读"**此刻**的那个人"，但又不能把 `user` 放进依赖表
   *   （那会让它每次渲染都换一个新函数，而它又在下面 `useMemo` 的依赖里）。
   *   用 ref 拿着当前值，是这一处唯一干净的写法。
   */
  const userRef = useRef(user)
  userRef.current = user

  const rename = useCallback(async (nickname: string) => {
    // 函数式写法拿的是"这一刻"的人，而不是这个回调被创建时闭包住的那个
    // （改名期间正好登出的话，闭包里那个会把人写回来）
    const current = userRef.current
    if (!current) return
    const result = await updateNickname(current, nickname)
    // ★ 失败**抛**而不是吞掉：界面上那一格要说"没改成"，不能说"改好了"
    if (!result.ok) throw new Error(result.message)
    saveUser(result.user)
    setUser(result.user)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, signIn, signOut, rename }),
    [user, ready, signIn, signOut, rename],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
