import type { Metadata } from 'next'
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
      <body>{children}</body>
    </html>
  )
}
