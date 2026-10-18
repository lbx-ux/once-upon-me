import type { Metadata } from 'next'
import AuthProvider from '@/components/auth/AuthProvider.tsx'
import VoiceProvider from '@/components/voices/VoiceProvider.tsx'
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
        {/* ★ 「谁在用」挂在 layout 上，不在各页面里：侧栏底部那一格在工作台里，
            个人主页在另一屏，两处读的必须是同一份。 */}
        {/* ★ 音色套在它里面，而且**必须在里面**：`canNarrate` 要读 `allowed` 与
            `configured`（那两样是 `AuthProvider` 给的）。套反了不是报错，
            是音色那一格永远说"没有权限"——一个安静的、只在真登录之后才看得见的错。
            （原来这里是 `SettingsProvider`：它装着"模型与密钥"，而那一格 2026-10-16
            被用户整条拆掉了。见 `VoiceProvider` 的文件头。） */}
        <AuthProvider>
          <VoiceProvider>{children}</VoiceProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
