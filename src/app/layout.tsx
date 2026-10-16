import type { Metadata } from 'next'
import AuthProvider from '@/components/auth/AuthProvider.tsx'
import SettingsProvider from '@/components/settings/SettingsProvider.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: '小主角 · Once Upon Me',
  description: '说出孩子的名字和爱好，得到一本以他为主角、用你的声音朗读、可以反复探索的定制绘本。',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {/* ★ 设置挂在 layout 上，不在各页面里：模型与密钥是**跨页面的一件东西**
            （创作流要用它生成、以后的主页要用它显示"这本书会不会有朗读"），
            放在页面里就会出现"两个抽屉各自一份状态"。 */}
        {/* ★ 「谁在用」同理，而且比设置更是跨页面的：侧栏底部那一格在工作台里，
            个人主页在另一屏，两处读的必须是同一份。套在设置外面——
            登录态比设置更"外"（有了人，才谈得上他的模型与密钥）。 */}
        <AuthProvider>
          <SettingsProvider>{children}</SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
