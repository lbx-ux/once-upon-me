'use client'

/**
 * AuthProvider —— 「现在是谁在用」这一份状态的家（今天：真后端在管）
 *
 * 与上一版相比，它**少了一件麻烦、多了一件事实**。
 *
 * ★ 少的麻烦：**首屏那一下闪烁没了**。上一版文件头第 2 条写着"已登录的人刷新
 * `/home`，侧栏那一格先是「请登录」、后是「个人主页」"，并注明
 * "等后端落地，这件事会自然消失：那时候身份在服务端的 session cookie 里"。
 * 就是今天：cookie 是 httpOnly 的，客户端挂载后问一次 `/api/auth/me`
 * （一次请求，而不是"先猜一个再纠正"），拿到之前渲染的是那个**中性的**
 * 头像位（`ready` 仍然是 `false`，界面据此只画壳不画名字）。
 *
 * ★ 多的事实：**三个不同的问题要分开回答**，而它们混成一个布尔之后
 * 界面上就再也说不出真话：
 *   · `user`        —— 这个人是谁
 *   · `permissions` —— **站长给了他什么**（四个开关，决定他能不能创作）
 *   · `configured`  —— **站里自己配齐了什么**（密钥在不在）
 * 「能不能生成一本书」= (`text` 有权限 **且** 服务端配了文本)
 *                    **且** (`image` 有权限 **且** 服务端配了图像)。
 * 缺哪一半，界面上那句话是不一样的："找站长开权限" vs "站里还没配好"。
 *
 * ★ 写账号只走 `lib/auth/client.ts`（与上一版同一条纪律）：漏掉一处 `fetch`
 * 的症状是"改了但没存"，它不报错。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import {
  fetchMe,
  logout as logoutRequest,
  pickAvatar as pickAvatarRequest,
  updateNickname,
} from '@/lib/auth/client.ts'
import { NO_PERMISSIONS, type AuthUser, type Permissions } from '@/lib/auth/state.ts'

export type AuthContextValue = {
  user: AuthUser | null
  /** 站长给这个人的四个开关。未登录时四个全 false */
  permissions: Permissions
  /** 站里自己配齐了哪几个能力（密钥在不在）。★ 与 `permissions` 是两件事 */
  configured: Permissions
  /** 本机那份读完了吗。★ 未读完时不要拿它做"要不要显示"的判据 */
  ready: boolean
  /** 读登录态时出的错（后端连不上）。★ 与"没登录"是两件事，界面要分开说 */
  meError: string | null
  /** 登录成功：调用方拿到 `AuthUser` 之后调它，这里顺手把权限刷一遍 */
  signIn: (user: AuthUser) => void
  /** 退出登录：请 BFF 把 cookie 删掉，然后清内存 */
  signOut: () => Promise<void>
  /** 改昵称。失败时抛（界面那一格要说"没改成"） */
  rename: (nickname: string) => Promise<void>
  /** 换一个默认头像 */
  pickAvatar: (avatarId: string) => Promise<void>
  /** 重新问一次"我是谁"（管理页改完权限回来时有用） */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 必须在 <AuthProvider> 里用')
  return value
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [configured, setConfigured] = useState<Permissions>(NO_PERMISSIONS)
  const [ready, setReady] = useState(false)
  const [meError, setMeError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await fetchMe()
    if (!result.ok) {
      // ★ "读不出来"与"没登录"分开：前者要说"账号服务连不上"，
      //   后者只是"请登录"——把前者伪装成后者会让人一直去点登录
      setMeError(result.message)
      return
    }
    setMeError(null)
    if ('signedOut' in result) {
      setUser(null)
      setConfigured(NO_PERMISSIONS)
      return
    }
    setUser(result.user)
    setConfigured(result.configured)
  }, [])

  useEffect(() => {
    void refresh().finally(() => setReady(true))
  }, [refresh])

  const signIn = useCallback(
    (next: AuthUser) => {
      setUser(next)
      // ★ 权限与"站里配齐了什么"要再问一次：登录响应里只有权限，
      //   而 `configured` 是 BFF 现算的（它读的是服务端环境变量）
      void refresh()
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await logoutRequest()
    setUser(null)
    setConfigured(NO_PERMISSIONS)
    setMeError(null)
  }, [])

  const rename = useCallback(async (nickname: string) => {
    const result = await updateNickname(nickname)
    // ★ 失败**抛**而不是吞掉：界面上那一格要说"没改成"，不能说"改好了"
    if (!result.ok) throw new Error(result.message)
    setUser(result.user)
  }, [])

  const pickAvatar = useCallback(async (avatarId: string) => {
    const result = await pickAvatarRequest(avatarId)
    if (!result.ok) throw new Error(result.message)
    setUser(result.user)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      // ★ 权限从 `user` 上读（它每次都是后端现给的），不另存一份——
      //   两份会漂，而漂的那一刻的症状是"界面说能用、服务端说不行"
      permissions: user?.permissions ?? NO_PERMISSIONS,
      configured,
      ready,
      meError,
      signIn,
      signOut,
      rename,
      pickAvatar,
      refresh,
    }),
    [user, configured, ready, meError, signIn, signOut, rename, pickAvatar, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
