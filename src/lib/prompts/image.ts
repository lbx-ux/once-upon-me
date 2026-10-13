/**
 * image.ts —— 逐页画面的提示词组装（v1）
 *
 * ★ 这一文件是"学费进代码"的地方。下面每一条约束都对应仓库里一次实测踩坑，
 *   出处标在行内，改之前请先去把那条记录读一遍：
 *
 * | 约束 | 实测来源 |
 * | --- | --- |
 * | 画面里一律不放任何文字 | `docs/cover-art-prompts.md`：中文文字不可靠（错字、缺笔、乱码） |
 * | 不写"留白 / 安全边距" | `docs/demo-book-art-prompts.md` 云批次：会被读成**留白**，真画出白纸边 |
 * | 负极清单必须同时写"要出现什么" | 同上 §五：只写"不要什么"会失效 |
 * | 角色段只从角色卡派生，页级 prompt 不许描述长相 | 本项目的架构决定：一处真相，见 card.ts |
 *
 * 组装顺序固定：**画风 → 角色段 → 页级 → 负极清单 → 构图**。
 * 顺序不是审美选择，是横评可比性的前提（ADR-0002 第二个理由）。
 */

import type { CharacterCard } from '../engine/domain.ts'
import { promptFragmentOf } from '../engine/character-card/card.ts'

export const IMAGE_PROMPT_VERSION = 'image-page@v1'

/** 负极清单。每条后面都跟一句"要出现什么"——只写不要，模型会画出一个它认为不要的反面 */
const NEGATIVE_BLOCK = [
  '避免出现：任何文字、字母、数字、签名、水印、画框边、分镜格；',
  '避免出现：多余的手指（每只手 5 指为限）、第二张脸、畸形的肢体、成人的身材比例套在孩子身上；',
  '避免出现：写实照片质感、恐怖的光影、尖锐的暗色阴影、血与伤口。',
  '应当出现的是：柔和的侧向暖光、清楚的轮廓、孩子约占画面高度的一半、留出走动的空间给文字排版。',
].join('\n')

/** 跨页构图约束：正文叠在**左页下角**，所以那块地方不能有重要内容（首页第二屏实测过） */
const COMPOSITION_BLOCK =
  '构图：主体偏右或居中，左下方约四分之一留出相对干净、可叠字的区域（不要画成白纸，只是不要放关键内容）。'

export type PagePromptInput = {
  card: CharacterCard
  /** 页级描述，来自规划的 imagePrompt 字段 */
  page: string
  scene: string
  mood: string
  /** 参考图不参与 prompt 文本，它是请求里的另一个字段 */
}

/**
 * 一页的完整 prompt。
 *
 * `scene` 也进 prompt：正文是给耳朵听的，场景是给眼睛看的，两者不一致时
 * 画出来的东西会跟文字对不上（实测过的失败模式：正文说"他游到鲸鱼身边"，
 * 画面只给了个"海边"）。
 */
export function pagePrompt(input: PagePromptInput): string {
  return [
    promptFragmentOf(input.card),
    `本页画面：${input.page}`,
    `情节：${input.scene}`,
    `情绪：${MOOD_HINTS[input.mood] ?? input.mood}`,
    COMPOSITION_BLOCK,
    NEGATIVE_BLOCK,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 情绪 → 光线与色调的说法。模型不懂 "tender"，但懂"傍晚的暖光，对比压低" */
const MOOD_HINTS: Record<string, string> = {
  calm: '安静的夜晚或柔和室内光，对比低，动作幅度小',
  wonder: '微微仰视的构图，一束光落在新出现的东西上',
  joy: '明亮的整体光，色彩饱和度高一点，人物姿态舒展',
  tense: '压暗一档但不恐怖：阴影柔和、边缘虚，绝不出现尖角与暗色怪物',
  tender: '近距离、暖色、浅景深，两个角色之间留很少的空',
  proud: '略仰角、开阔背景、光从角色身后打过来形成轮廓光',
}

/**
 * 出图尺寸。**默认一律 1440x1440**，理由三条，缺一不可：
 *
 * 1. 实测通过：`768x768 / 1024x1024 / 1280x720 / 1440x1440 / 2048x2048` 在白名单里，
 *    而 `512x512` 反而被拒（模型.md §4）。
 * 2. 一口价 0.20 元/张**与尺寸无关** → 同价之下取大的。
 * 3. 3:2 与 3:4 的直出尺寸**未实测**，所以不猜：跨页与封面都从方图居中裁。
 *    这不是妥协，是首页三屏已经在用的做法（`docs/cover-art-prompts.md`：
 *    16:9 封面靠居中裁、3:4 竖版从 2:3 裁），构图在出图时按"中心留主体"控制。
 *
 * 将来若要直出 3:2：先单独测一次那个尺寸（一次成功 = 0.20 元），
 * 测过再把值填进这张表并在这里注明日期。
 */
export const DEFAULT_IMAGE_SIZE = '1440x1440'
