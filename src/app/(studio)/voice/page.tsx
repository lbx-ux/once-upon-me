import VoicePicker from '@/components/studio/VoicePicker.tsx'

/**
 * /voice —— 声音（工作台的第四格）
 *
 * 服务端这层没有事做：音色与密钥都在客户端那份设置里（key 不落盘，
 * 服务端也就无从代取），所以只有 metadata 与一个组件。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '声音 · 小主角' }

export default function VoicePage() {
  return <VoicePicker />
}
