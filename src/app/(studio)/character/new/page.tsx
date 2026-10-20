import NewChild from '@/components/studio/NewChild.tsx'

/**
 * /character/new —— 新建一个小主角（工单 03 第二刀）
 *
 * 这一屏是客户端组件自己拿设置的（`useSettings`）：出形象要真的调一次图像接口，
 * 而密钥是家长自己带的、只活在内存里（ADR-0008），服务端渲染时读不到。
 * 所以这一页不做任何取数，只挂一个壳。
 *
 * 它不预填"你已经有几个孩子"之类的统计：那些数在这一屏上不改变任何人要做的事，
 *   而多一次磁盘读就多一处"这一屏挂了是因为读目录失败"的可能。
 */

export const dynamic = 'force-dynamic'

export const metadata = { title: '新建小主角 · 小主角' }

export default function NewChildPage() {
  return <NewChild />
}
