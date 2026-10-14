/**
 * character-sheet.ts —— 角色标准像（角色卡的参考图）的提示词，带版本号
 *
 * ★ 这份提示词在 W1 是从 `scripts/make-demo-cards.mts` 里长出来的（两张演示卡就是它的产物），
 *   现在提到这里，理由是**它有两个消费者**了：那个脚本（预生成演示卡）与
 *   创作流第 3 步（家长现场做卡）。留在脚本里的话，第二条路会抄一份，然后开始漂。
 *
 * 三处约束是从 `gpt-image-2-style-library` 的 character-design-sheet 那一档抄来的
 * （它的 guidance 正是"定义身份锚点、服装、比例、版式，保持脸/发型/服装一致"），
 * 而它的两条 pitfall 被直接写成了约束：**单姿势单画面**（画面一挤就少画手指）、
 * **风格与构图分开成块**（混在一句话里，模型会把两者一起打折）。
 *
 * ★ 一张参考图只负责一件事：**"他是谁"**。所以背景是空的、表情是平的、构图是正的。
 *   场景、动作、光线全属于页级提示词（`image.ts`），把它们写进来会让这张图不再是"标准像"。
 */

import type { CharacterAnchor, StyleLock } from '../engine/domain.ts'

export const CHARACTER_SHEET_VERSION = 'character-sheet@v1'

/** 画风段。与 `docs/demo-book-art-prompts.md` 的既定描述一致（26 张成图都是这一套出来的） */
export const DEFAULT_STYLE_FRAGMENT =
  '温暖手绘绘本插画：水彩铺色打底 + 细彩铅轮廓线收形，可见纸质纹理，' +
  '高明度低饱和的粉彩色板，柔和的左上方统一光源，阴影无硬边'

/**
 * 界面上给人看的那三个字（工作台的画风那一格）。
 *
 * ★ 为什么贴在提示词旁边而不是写在组件里：它是上面那段话的**摘要**，
 *   两者说的必须是同一件事。分开写，改提示词的人不会想到去改界面，
 *   于是屏幕上写着"水彩"、画出来的是别的东西——这类漂移最难发现。
 *   盯住这条的是 `style.test.ts`。
 * ★ 产品现在**只有这一档**画风（`/api/cards` 建卡时写死 `warm-handdrawn`），
 *   所以界面上它是一个"事实"，不是一个下拉。做成下拉就是摆一个假控件。
 */
export const DEFAULT_STYLE_LABEL = '水彩'

export type CharacterSheetInput = {
  name: string
  /** 用来决定"小男孩/小女孩"这类词。给孩子自己用的称呼，不是账号 */
  childWord: string
  ageLabel: string
  anchors: readonly CharacterAnchor[]
  style?: StyleLock
}

export function characterSheetPrompt(input: CharacterSheetInput): string {
  const style = input.style?.promptFragment || DEFAULT_STYLE_FRAGMENT
  return [
    `画一张儿童绘本的**角色标准像**：${input.name}，东亚面孔，${input.ageLabel}${input.childWord}。`,
    '',
    '【身份锚点——每一条都必须画出来，它们是后续所有页的核对依据】',
    ...input.anchors.map((anchor, index) => `${index + 1}. ${anchor.value}`),
    '',
    '【构图】竖构图居中，单人，站姿正面略偏 15 度，双手自然垂放，全身入画（头顶与脚底各留约 8% 空间）。',
    '背景是一层极淡的暖米色平涂，不放任何场景物件——这张图只负责"他是谁"。',
    '视线看向画外，表情平和带一点好奇，不做夸张表情。',
    '',
    `【风格】${style}`,
    '',
    '【文字】画面内不出现任何文字、字母、数字、签名、水印。',
    '',
    '【约束】不要第二张脸；不要多余的手指（每只手 5 指为限）；不要成人的身材比例套在孩子身上；',
    '不要写实照片质感；不要深色压抑的背景；不要多格分镜、拼贴、画框、样机、阴影底板。',
  ].join('\n')
}

/**
 * 年龄档 → 提示词里的说法。
 *
 * ★ 用"几岁左右"而不是精确岁数：锚点里没有生日，编一个确切的数字会让模型
 *   画出一个我们没依据的年龄（而"4 岁"与"6 岁"画出来的脸差别很大）。
 */
export function ageLabelOf(ageBand: string): string {
  switch (ageBand) {
    case '4-':
      return '三四岁左右'
    case '4-6':
      return '四五岁左右'
    case '6-8':
      return '六到八岁'
    default:
      return '八岁以上'
  }
}
