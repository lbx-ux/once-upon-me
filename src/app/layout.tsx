import type { Metadata, Viewport } from 'next'
import AuthProvider from '@/components/auth/AuthProvider.tsx'
import VoiceProvider from '@/components/voices/VoiceProvider.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: '小主角 · Once Upon Me',
  description: '说出孩子的名字和爱好，得到一本以他为主角、用你的声音朗读、可以反复探索的定制绘本。',
}

/**
 * 视口（2026-10-19 移动端适配）—— **这一份不是可选的样板，它有一条真前提**。
 *
 * ★ `viewportFit: 'cover'` 是 `env(safe-area-inset-*)` 生效的**前提**：不声明它，
 *   iOS 会把页面限制在安全区内，那四个变量**恒为 0**。而这一轮横屏阅读要用的正是
 *   被刘海与圆角占掉的那两条边 —— 书左右铺满时，那两条正好压在上面。
 *   （另一边：`viewport-fit=cover` 之后页面会伸进刘海，所以**消费方必须自己让开**，
 *   安全区令牌在 `globals.css` 的 `:root` 里，见那一段。）
 * ★ `width` / `initialScale` 与 Next 的默认值一致，写出来是为了这两条不再靠"默认"：
 *   默认值是 Next 的版本号说了算的东西，而这一条是这一屏的版面说了算的。
 * ★ `maximumScale` / `userScalable` **不设**：禁掉缩放是拿无障碍换版面整齐，
 *   而这一屏的正文最小只有 11–12px，正是不该被禁的那种。
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
