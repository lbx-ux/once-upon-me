/**
 * 首屏轨道上的 12 个主题 —— 与美术资源一一对应
 *
 * 数据来源：docs/cover-art-prompts.md 的「12 张卡的内容」一节
 * 资源文件：public/art/{key}.webp（封面静帧，1280×720，脚本 scripts/make-webp.py）
 *
 * ★ 数组顺序是有意义的：它决定 12 张卡片在环上的排列顺序，
 *   改动会让首屏整体错位。新增主题请追加到末尾。
 */

export const THEME_KEYS = [
  'dino',
  'paint',
  'rocket',
  'bird',
  'star',
  'moon',
  'whale',
  'castle',
  'cloud',
  'flower',
  'turtle',
  'balloon',
] as const

export type ThemeKey = (typeof THEME_KEYS)[number]

export type Theme = {
  /** 同时也决定资源文件名：public/art/{key}.webp */
  key: ThemeKey
  emoji: string
  /** 中文名，用作 <img alt> 与无障碍朗读 */
  label: string
  /** 主题词 —— 这张卡在讲什么，用于调试与后续选题推荐 */
  tagline: string
}

export const THEMES: readonly Theme[] = [
  { key: 'dino', emoji: '🦕', label: '恐龙', tagline: '发现' },
  { key: 'paint', emoji: '🎨', label: '画画', tagline: '我画的' },
  { key: 'rocket', emoji: '🚀', label: '火箭', tagline: '出发' },
  { key: 'bird', emoji: '🐣', label: '小鸟', tagline: '轻轻的' },
  { key: 'star', emoji: '⭐', label: '星星', tagline: '一起看' },
  { key: 'moon', emoji: '🌙', label: '月亮', tagline: '睡前' },
  { key: 'whale', emoji: '🐋', label: '鲸鱼', tagline: '你好，大家伙' },
  { key: 'castle', emoji: '🏰', label: '城堡', tagline: '我们一起' },
  { key: 'cloud', emoji: '☁️', label: '云', tagline: '像什么？' },
  { key: 'flower', emoji: '🌸', label: '花', tagline: '发芽了' },
  { key: 'turtle', emoji: '🐢', label: '乌龟', tagline: '慢慢来' },
  { key: 'balloon', emoji: '🎈', label: '气球', tagline: '分你一个' },
] as const

/** 封面资源路径 —— 统一从这里取，避免 '/art/' 这个约定散落在各处 */
export function artPath(key: ThemeKey): string {
  return `/art/${key}.webp`
}

/**
 * 派生小图（`scripts/make-webp.py` 从 `public/art/` 缩/裁出来，不是新出的一批画）
 *
 * ★ 为什么不走 `/api/assets?w=`：静态 `public/` 走不到那条通路——Next 直接发盘上的字节，
 *   查询串它看不懂，挂 `?w=` 会静悄悄回原图（docs/known-tradeoffs.md 缩略档那条）。所以预生成。
 * ★ 文件名仍然只由 `key` 决定，与 `artPath` 同一条约定：对不上就是一张裂图。
 */

/** 工作台主题墙那一格（16:9 / 320px / 实测平均 11 KB） */
export function themeCardPath(key: ThemeKey): string {
  return `/art-cards/${key}.webp`
}
