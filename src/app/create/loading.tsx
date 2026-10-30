import RouteSkeleton from '@/components/system/RouteSkeleton.tsx'

/**
 * `/create` 在等数据时的那一屏（2026-10-30）
 *
 * 与 `(studio)/loading.tsx` 同一份骨架，只少两格：这一屏是"这一本书"的整幅工作区，
 * 下面不会长出一排卡片墙。理由与 2026-10-20 那次反转的账都写在那一份里。
 *
 * 这一屏有两条入口（开跑一本 / 接着做一份草稿），其中一条会 `redirect`；
 * 骨架挂在段上，两条路都盖得到。
 */
export default function CreateLoading() {
  return <RouteSkeleton tiles={3} />
}
