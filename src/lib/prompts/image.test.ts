/**
 * image.test.ts —— 页图与封面的形状契约
 *
 * 这一组盯着的是 2026-10-15 那次返工：整本书出图尺寸是 1440×1440 方形，
 *   而跨页构图（`COMPOSITION_BLOCK` 写的是"主体偏右、左下留出可叠字区"）本来就是按 3:2 写的，
 *   方图裁成 3:2 等于先按方构图再切掉两端，留出的那块会被切走或位移。
 *   封面的 3:4 同理。
 *
 * 所以这里钉两件事：
 * 1. 比例，不是具体像素——写死 `1536x1024` 会在换模型时变成绊脚石，
 *    但"必须是 3:2"是产品定义（跨页的形状），它不该被顺手改掉。
 * 2. 画面里不许出现书名：封面 prompt 必须明确说这句话。
 *    `docs/cover-art-prompts.md` 记过教训——中文进图必然错字/缺笔/乱码。
 */

import { describe, expect, it } from 'vitest'

import {
  COVER_IMAGE_SIZE,
  DEFAULT_IMAGE_SIZE,
  IMAGE_PROMPT_VERSION,
  anchorNoteOf,
  coverPrompt,
  pagePrompt,
} from './image.ts'
import type { CharacterCard } from '../engine/domain.ts'
import { SIZES_BY_MODEL } from '../engine/providers/tokenrhythm-image.ts'

/** 一个够用的假卡：只用到 anchors/style/revision 这几处 */
const card: CharacterCard = {
  cardId: 'test-card',
  childId: 'kid',
  revision: 1,
  anchors: [
    { slot: 'bone', value: '圆脸' },
    { slot: 'hair', value: '左上方翘一撮' },
  ],
  style: { key: 'warm-handdrawn', promptFragment: '温暖手绘水彩绘本插画', ratio: '3:2' },
  reference: { path: 'cards/test/ref.png', digest: 'abc', bytes: 3, mime: 'image/png' },
  digest: 'deadbeef',
  createdAt: 0,
} as unknown as CharacterCard

function ratioOf(size: string): number {
  const [w, h] = size.split('x').map(Number)
  return (w as number) / (h as number)
}

describe('出图尺寸的比例（这是产品定义，不是随手填的数）', () => {
  it('页图是 3:2 横版', () => {
    expect(ratioOf(DEFAULT_IMAGE_SIZE)).toBeCloseTo(1.5, 3)
  })

  it('封面是 3:4 竖版（与首页演示书 cover.webp 848×1130 同比例）', () => {
    expect(ratioOf(COVER_IMAGE_SIZE)).toBeCloseTo(0.75, 3)
  })

  it('页图与封面不是同一个尺寸——一份尺寸同时管两种形状是不可能的', () => {
    expect(DEFAULT_IMAGE_SIZE).not.toBe(COVER_IMAGE_SIZE)
  })

  /**
   * 这一条是花了一次真跑换来的：我把尺寸改成 3:2 之后直接开跑，
   *   三页全被适配器在发请求前退回（"不在实测白名单里"）——一分钱没花，
   *   但整本书没出成。改产品尺寸却忘了扩供应商白名单，症状就是这样。
   *   探针当时能过，是因为它绕开了适配器直接打接口。
   *   所以"两个常量都在白名单里"必须有一条断言，而不是靠人记得。
   */
  it('★ 产品要用的两个尺寸都在供应商白名单里（改尺寸忘了扩白名单，这条会红）', () => {
    const allowed: readonly string[] = SIZES_BY_MODEL['wan2.7-image'] ?? []
    expect(allowed).toContain(DEFAULT_IMAGE_SIZE)
    expect(allowed).toContain(COVER_IMAGE_SIZE)
  })
})

describe('页图的 prompt 仍然是按跨页写的', () => {
  const prompt = pagePrompt({ card, page: '坐在云上', scene: '云像棉花糖', mood: 'wonder' })

  it('带上"左下留出可叠字区"那条构图约束', () => {
    expect(prompt).toContain('左下方')
  })

  it('不许把页级描述写成长相（长相只从角色卡派生）', () => {
    expect(prompt).toContain('温暖手绘水彩绘本插画')
    expect(prompt).toContain('坐在云上')
  })

  /**
   * 这一组是 2026-10-16 那条报障的钉子：
   *   「我提供给你的是男孩子，怎么生成出来有男孩有女孩子」（8 页里 1/4/6 像男孩，
   *   2/3/5/7/8 像女孩）。根因是性别那个词从来没进过逐页 prompt——
   *   它只进了标准像（`character-sheet.ts` 的 `childWord`），而卡的锚点里也没有性别词。
   *   更要紧的是有几页的画面描述里根本没有这个孩子（"纸箱内部的主观视角"、
   *   "夜空"、"一只手递出糖果"），模型只能自己补一个人。
   */
  it('★ 每一页都写着"整本书是同一个人"，哪怕这一页只看得见一只手', () => {
    expect(prompt).toContain('同一个人')
    expect(prompt).toContain('只看得见一部分')
    // 「不要换性别」是这条不变式里最先跑偏的那一项（实测：头发从短发变成长发）
    expect(prompt).toContain('不要换性别')
  })

  it('★ 给了称呼就把它写进那一行', () => {
    const withWord = pagePrompt({
      card,
      page: '坐在云上',
      scene: '云像棉花糖',
      mood: 'wonder',
      childWord: '小男孩',
    })
    expect(withWord).toContain('（小男孩）')
  })

  it('★ 不给称呼时那一行**还在**，只是没有括号里那个词', () => {
    // 中性词与"没有这一行"是两件事：不变式（每一页是同一个人）与性别词，
    // 只有后者依赖档案。这条钉住的是"别把整行一起省掉"
    expect(prompt).toContain('同一个人')
    expect(prompt).not.toContain('（小男孩）')
  })
})

/**
 * ── 锚点回灌（2026-10-20，计划表 B7）
 *
 * 这一组钉的是"重画那一次到底有没有带上结论"。`card` 那张假卡只有两条锚点
 * （骨相/头发），够用：缺的那条要能被补上、认不出的那条要原样留下。
 */
describe('anchorNote：把"哪几条不像"翻成一句能喂回去的话', () => {
  it('★ 半截话要认出来并把卡上的原文补回去', () => {
    // 真书里录下来的原文就是这种形状（模型把清单里冒号后面那截丢了）：
    // `events.jsonl` 的 missedAnchors 是 ["头身比是否一致"]、"眼睛是否一致"…
    expect(anchorNoteOf(card, ['头发是否一致'])).toBe('头发：左上方翘一撮')
  })

  it('多条之间用「；」连成一句', () => {
    expect(anchorNoteOf(card, ['骨相是否一致', '头发是否一致'])).toBe(
      '骨相：圆脸；头发：左上方翘一撮',
    )
  })

  it('★ 认不出的原样带上，不许在这一层丢掉', () => {
    // 丢掉等于替模型决定"这句没用"，而这一层没有那个资格
    expect(anchorNoteOf(card, ['右下角那只玩偶的眼睛'])).toBe('右下角那只玩偶的眼睛')
  })

  it('认得出的与认不出的混在一起时，两种都留', () => {
    const note = anchorNoteOf(card, ['头发是否一致', '左手多了一根手指', '头发是否一致'])
    expect(note).toBe('头发：左上方翘一撮；左手多了一根手指')
  })

  it('★ 空清单回 undefined —— 没有结论就不编一句结论', () => {
    expect(anchorNoteOf(card, [])).toBeUndefined()
    expect(anchorNoteOf(card, ['   ', ''])).toBeUndefined()
  })
})

describe('pagePrompt 接住 anchorNote', () => {
  const base = { card, page: '坐在云上', scene: '云像棉花糖', mood: 'wonder' }

  it('★ 不传 anchorNote 的那份，两个可选块一个都没被塞进来', () => {
    const bare = pagePrompt(base)
    expect(bare).not.toContain('上一版经核对')
    expect(bare).not.toContain('这一版要改掉上一版的问题')
    /**
     * 2026-10-20 改了这三行：`@v5` 在页级三项之后无条件多了一句优先级
     *   （`PRECEDENCE_BLOCK`），所以"紧接着就是构图"这句话不再成立。
     *   要守的不变式一个字没变——页级三项之后没有任何"这一次才有"的东西：
     *   `情绪` → `优先级`（每页都有）→ `构图`（每页都有），中间空着。
     *   这条测试原来是拿行号钉的，所以它同时钉住了"模板长什么样"；
     *     模板一改就必须来改它——那正是它该红的时候，不该绕开。
     */
    const lines = bare.split('\n')
    expect(lines[4]).toContain('情绪：')
    expect(lines[5]).toContain('优先级：')
    expect(lines[6]).toContain('构图：')
  })

  it('传了就写成一句"上一版哪里不像"，并且落在页级三项之后', () => {
    const prompt = pagePrompt({ ...base, anchorNote: '头发：左上方翘一撮' })
    expect(prompt).toContain('上一版经核对')
    expect(prompt).toContain('头发：左上方翘一撮')
    expect(prompt.indexOf('情绪：')).toBeLessThan(prompt.indexOf('上一版经核对'))
    expect(prompt.indexOf('上一版经核对')).toBeLessThan(prompt.indexOf('构图：'))
  })

  it('★ 两个修正块同时在时，人那句排在模型那句之后', () => {
    // 人写的是命令、模型那句是诊断，命令排在后面
    const prompt = pagePrompt({
      ...base,
      anchorNote: '头发：左上方翘一撮',
      fixNote: '把帽子去掉',
    })
    expect(prompt.indexOf('上一版经核对')).toBeLessThan(prompt.indexOf('这一版要改掉上一版的问题'))
  })

  it('★ 空白串当作没传（`trim()` 之后才判），不会留下一行空壳', () => {
    expect(pagePrompt({ ...base, anchorNote: '   ' })).toBe(pagePrompt(base))
  })
})

describe('封面的 prompt', () => {
  const prompt = coverPrompt({ card, title: '云朵小船去旅行' })

  it('★ 明确要求"不要把书名画进画面"', () => {
    // 这句话丢了，症状是图上出现错字书名——而它看着像"模型不行"，不像提示词少了约束
    expect(prompt).toContain('不要把书名画进画面')
    expect(prompt).toContain('云朵小船去旅行')
  })

  it('仍然是同一条角色段（封面与内页必须是同一个孩子）', () => {
    expect(prompt).toContain('温暖手绘水彩绘本插画')
    expect(prompt).toContain('左上方翘一撮')
  })

  it('带上负极清单——只写"不要什么"会失效，这条在别的文件里也记过', () => {
    expect(prompt).toContain('避免出现：任何文字')
    expect(prompt).toContain('应当出现的是')
  })

  it('promptVersion 与页图同源（同一个出图管线，不是第二条流水线）', () => {
    // 2026-10-16 抬到 @v2：模板多了一个可选的 `fixNote` 尾块（逐页重画时
    //   "这一次哪里不对"那句）。不写它的页逐字节与 v1 相同，但版本号说的是模板、
    //   不是某一次调用的参数——而 `provenance.promptVersion` 正是"这批图的通过率
    //   能不能互相比较"的那个界。钉子拔了就等于允许以后悄悄改模板。
    // ★ 同一天再抬到 @v3：模板多了一行恒定输出的「主角是同一个人，不要换性别」
    //   （见上面那一组用例）。这一行与 fixNote 不同——它对每一页都生效，
    //   所以 v2 那批图与 v3 那批图不是同一份模板出的，通过率不能混着算。
    // 2026-10-20 抬到 @v4：多了一个可选的 `anchorNote`（比对模型上一轮的结论，
    //   回灌进下一次重画，见上面那一组）。它与 v2 那次是不同的情形：
    //   第 1 次的提示词逐字节仍等于 v3，首次通过率照样可比；
    //   不可比的是"重画后通过率"——那正是这次要改的东西。要分档看 `attempt`。
    // 2026-10-20 抬到 @v5：多了一句对每一页都生效的优先级
    //   （`PRECEDENCE_BLOCK`：角色描述与「避免出现」压过这一页的描述），
    //   并把 `本页画面` / `情节` 两个值包进了「」。与 v2/v4 那两次"可选块"不同
    //   ——这一次每一页都变了，所以 v4 那批读数到此封箱，跨版本不能混着比。
    expect(IMAGE_PROMPT_VERSION).toBe('image-page@v5')
  })
})

/**
 * 出图这条路没有文字闸，事后只有那一档不可复现的画面审核兜着
 *   （`review.ts` 里那句：出图没有"我们替你重写一版"这条路）。
 *   而这一份提示词里有两类会打架的东西——角色描述/构图/负极清单是代码里的常量，
 *   `本页画面`/`情节`/书名是 `story.json` 里的字，家长可以逐字改。
 *
 * 所以 2026-10-20 补了两件事，这一组盯的就是它们：
 *
 * 1. 声明谁赢（`PRECEDENCE_BLOCK`）：不写清的话，一句"这一次改成两只手各拿
 *    一把刀"会与负极清单正面撞上，而模型照哪一条全看运气。
 * 2. 把家长可改的那几处包进「」：引号划出"这是被引用的字"，
 *    而不是"这是给你的要求"。与 `story-plan.ts` 那三格、检索片段那一段同一手法。
 *
 * 判据取的是"这句话在不在、在不在该在的位置"，不是整句逐字：
 *   逐字钉住会让每次润色都红一次，而这两条要防的是"有人把它删掉/挪走"。
 */
describe('★ 家长可改的那几处：引号划界 + 谁说了算（@v5）', () => {
  const base = { card, page: '坐在云上', scene: '云像棉花糖', mood: 'wonder' as const }

  it('本页画面与情节的值都包进「」（它们是 `story.json` 里的字，家长可逐字改）', () => {
    const prompt = pagePrompt(base)
    expect(prompt).toContain('「坐在云上」')
    expect(prompt).toContain('「云像棉花糖」')
  })

  it('★ 优先级那一句在每一页里，且排在构图与负极清单**之前**', () => {
    const prompt = pagePrompt(base)
    expect(prompt).toContain('优先级：')
    expect(prompt).toContain('避免出现') // 它点名的那一段确实在下面
    expect(prompt.indexOf('优先级：')).toBeLessThan(prompt.indexOf('构图：'))
  })

  it('★ 封面也有这一句（书名同样是模型写、家长可改的那一类）', () => {
    const prompt = coverPrompt({ card, title: '云朵小船去旅行' })
    expect(prompt).toContain('优先级：')
    expect(prompt.indexOf('优先级：')).toBeLessThan(prompt.indexOf('避免出现'))
  })

  /**
   * 反面的一半：`fixNote` 那一块是家长这一次的更正，不是被引用的内容——
   *   所以它不包引号（包了会读成"这是素材，参考着看"，而它是命令）。
   *   这一条防的是"照着上面那两行顺手也给它加一对「」"。
   */
  it('★ `fixNote` 不包引号：它是命令，不是被引用的内容', () => {
    const prompt = pagePrompt({ ...base, fixNote: '把云画少一点' })
    expect(prompt).toContain('这一版要改掉上一版的问题：把云画少一点')
    expect(prompt).not.toContain('「把云画少一点」')
  })
})
