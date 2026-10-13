/**
 * demoBook.ts —— 首页第二屏那本演示绘本的**内容**
 *
 * 只放内容：跨页图路径、每一面的正文、选择点的两个分支。
 * 几何在 flip.ts，渲染在 StorybookFlip.tsx —— W2 的阅读器要换内容时只动这一个文件。
 *
 * 用的是「云」那一批图（docs/demo-book-art-prompts.md），主角是小宇和他的小狗。
 * 4 个跨页 + 封面 + 封底 = **5 叶**，叶表见 flip.ts 顶部。
 *
 * ★ 半页不切文件：同一张 3:2 跨页图挂两次，靠 background-position 各取一半。
 *   所以这里一个跨页只有一个 image，左半右半是渲染时算出来的（见 buildLeaves）。
 */

export const BOOK_TITLE = '小宇的云'
export const BOOK_BYLINE = '以小宇为主角 · 用你的声音朗读'
/** 封底的落点句 —— 整本书的论点就这一句 */
export const BOOK_NOTE = '每一页，都是同一个他。'
export const BOOK_CTA = '把主角换成你的孩子'

/** 封面图。3:4 的封面装进 3:4 的页面，一比一，不裁（与跨页的半张同比例） */
export const COVER_IMAGE = '/book/cover.webp'

export type BranchKey = 'a' | 'b'

type Spread = {
  image: string
  /** 这一页的正文，叠在**左页**下角（真 HTML 文字，不是画进图里的） */
  text: readonly string[]
  /** 刻度上的短名 */
  caption: string
}

export type ArtFace = {
  kind: 'art'
  image: string
  /** 取这幅图的哪半 —— 半页不切文件，靠 background-position */
  half: 'left' | 'right'
  text?: readonly string[]
}

/** 封面与封底不用跨页图，内容由 StorybookFlip 叠字 */
export type PlainFace = { kind: 'cover' } | { kind: 'back' }

export type PageFace = ArtFace | PlainFace

export type Leaf = { front: PageFace; back: PageFace }

/** 固定跨页 S1–S3。第 4 个跨页由分支决定，见 BRANCHES */
const SPREADS: readonly Spread[] = [
  {
    image: '/book/spread-1.webp',
    caption: '像什么？',
    text: ['草地上的午后，小宇一动不动地躺着。', '天上的云，慢慢变成了别的东西——'],
  },
  {
    image: '/book/spread-2.webp',
    caption: '上去了',
    text: ['他伸手够到最近的一朵，坐了上去。', '云软软的，只比草坡高一点点。'],
  },
  {
    image: '/book/spread-3.webp',
    caption: '往哪朵云去',
    text: ['前面有两朵云。', '一朵像恐龙的背，宽得可以骑上去；一朵像船的肚子，坐进去正好。'],
  },
]

/**
 * 选择点的两个分支 —— **左 = 恐龙云，右 = 帆船云**，
 * 与 P1 封面、P4 那张图里的左右完全一致（出图文档 §一定死的）。
 * 顺序不许改：孩子看图、看按钮，方向反了就成两件事。
 *
 * `icon` 是那朵云自己的小插画（出图文档 P7）—— 按钮里放的就是画面里那一朵，
 * 不是系统 emoji。`emoji` 退成**兜底**：图还没进来时按下去看得见东西，
 * 而不是一个空框（见 StorybookFlip 的 .book-choice__icon）。
 */
export const BRANCHES: Record<BranchKey, Spread & { emoji: string; label: string; icon: string }> =
  {
    a: {
      image: '/book/spread-4a.webp',
      caption: '爬上恐龙的背',
      emoji: '🦕',
      label: '去恐龙云上',
      icon: '/book/choice-dino.webp',
      text: ['小宇爬上了恐龙云的脖子。', '每一步都软软的，像踩在晒过太阳的被子卷上。'],
    },
    b: {
      image: '/book/spread-4b.webp',
      caption: '坐进船帆里',
      emoji: '⛵',
      label: '去帆船云里',
      icon: '/book/choice-ship.webp',
      text: ['小宇坐进帆船云里，两条腿晃啊晃。', '小狗趴在他腿上睡着了。云慢慢地飘，风轻轻地吹。'],
    },
  }

export const BRANCH_ORDER: readonly BranchKey[] = ['a', 'b'] as const

/** 选择点上那句话。孩子不识字，所以按钮走「大图标 + 一句短问」双通道 */
export const BOOK_CHOICE_ASK = '你想去哪一朵？'

/** 默认分支：不选也能一路滚到底，走 A */
export const DEFAULT_BRANCH: BranchKey = 'a'

/**
 * 选择点落在**第 3 个跨页**上（也就是最后一个固定跨页）——
 * 它后面的第 4 个跨页由分支决定。
 * ★ 这个数必须与 StorybookFlip 的 P_Q 停顿段和选择窗口对齐，那里有开发期自检。
 */
export const CHOICE_PAGE = SPREADS.length

export const SPREAD_COUNT = SPREADS.length + 1 // 4 个跨页
export const LEAF_COUNT = SPREAD_COUNT + 1 // 5 叶

function spreadFour(branch: BranchKey): Spread {
  return BRANCHES[branch]
}

function allSpreads(branch: BranchKey): readonly Spread[] {
  return [...SPREADS, spreadFour(branch)]
}

function artFace(spread: Spread, half: 'left' | 'right'): ArtFace {
  // 正文只跟着**左半**走：右半翻过来时是同一张图的另一半，不该重复出字
  return half === 'left'
    ? { kind: 'art', image: spread.image, half, text: spread.text }
    : { kind: 'art', image: spread.image, half }
}

/**
 * 内容 → 叶。第 k 个跨页 = (第 k−1 叶的背面, 第 k 叶的正面)，见 flip.ts 的叶表：
 *   L0 封面 / S1左   L1 S1右 / S2左   L2 S2右 / S3左   L3 S3右 / S4左   L4 S4右 / 封底
 */
export function buildLeaves(branch: BranchKey): Leaf[] {
  const spreads = allSpreads(branch)
  const leaves: Leaf[] = []
  for (let i = 0; i <= spreads.length; i++) {
    leaves.push({
      front: i === 0 ? { kind: 'cover' } : artFace(spreads[i - 1], 'right'),
      back: i === spreads.length ? { kind: 'back' } : artFace(spreads[i], 'left'),
    })
  }
  return leaves
}

/** 刻度上的短名：0 = 封面，1–4 = 四个跨页 */
export function spineLabels(branch: BranchKey): string[] {
  return ['封面', ...allSpreads(branch).map((s) => s.caption)]
}

/**
 * 第 index 面（0 = 封面，1–4 = 跨页）的纯文本。
 * 给屏读用 —— 书那叠 3D 叶对辅助技术是一团噪音，所以整块 aria-hidden，
 * 由一段 aria-live 的正文替代（见 StorybookFlip）。
 */
export function pageText(branch: BranchKey, index: number): string[] {
  if (index <= 0) return [BOOK_TITLE, BOOK_BYLINE]
  const spread = allSpreads(branch)[index - 1]
  return [...spread.text]
}

/** 第 index 面在静止模式（reduced-motion）下要显示的图；封面走竖版封面那张 */
export function pageImage(branch: BranchKey, index: number): string {
  return index <= 0 ? COVER_IMAGE : allSpreads(branch)[index - 1].image
}
