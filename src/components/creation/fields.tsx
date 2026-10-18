/**
 * fields.tsx —— 创作流那一套表单零件，抽出来给**两个**入口共用（工单 03 第二刀）
 *
 * 谁在用：
 *   - `CreateFlow.tsx` 的第 1 步（创作流里"孩子是谁"）
 *   - `studio/NewChild.tsx`（`/character/new` 那一屏）
 *
 * ★ 抽出来的理由不是"少写几行"，是**那一套判据与那几组选项只能有一份**：
 *   姓名/读音/年龄档这三个必填项、八条锚点的槽位顺序，两处各写一遍的坏法是安静的——
 *   `/character/new` 多出一个 `'7+'` 的年龄档，或者少一个锚点槽位，
 *   而两边的界面都"看起来没问题"。
 *   校验本身（`stepProblems`）不在这里，它仍然在 `lib/creation/state.ts`：
 *   这里是**长相**，那里是**判据**，两个入口都从那里 import。
 *
 * ★ class 名仍然是 `cf__*`（创作流那一套）：`fields.css`（2026-10-16 从 `create-flow.css` 切出来）在 `globals.css` 里
 *   全局 import，两屏共用同一批字段样式，于是/new 那一屏的输入框与创作流里长得一模一样。
 *   换成一套新名字的代价是：同一种输入框在两个页面上慢慢变成两种样子。
 */

import type { ReactNode } from 'react'

import {
  AGE_BANDS,
  AGE_BAND_LABELS,
  ANCHOR_LABELS,
  ANCHOR_SLOTS,
  ANCHOR_STRENGTH,
  GENDER_LABELS,
  GENDERS,
  type AnchorSlot,
} from '@/lib/engine/domain.ts'
import { anchorsWith, DEFAULT_ANCHORS } from '@/lib/creation/default-anchors.ts'
import type { ChildForm } from '@/lib/creation/state.ts'

/**
 * 每一格的**示例文字**（灰字，坐在空框里）。
 *
 * ★ 2026-10-16 第 20 刀（用户："用户进入的时候，这里锚点里面的字都是灰色的，等待模型
 *   分析出来后，能够分析的地方就变成黑色字体，不能分析出来的还是灰色字体"）：
 *   这一段文字**以前是预填值**（`value`），现在是占位（`placeholder`）。同一个字串、
 *   同一个来源（`DEFAULT_ANCHORS`），换的只是它的**身份**——它不是这孩子的一条锚点，
 *   是"这一格该细到什么程度"的示范。
 * ★ 换身份这件事是有后果的，两处都是好的：① 灰=空，用户不会再以为自己已经填过了；
 *   ② 示例值**再也不会被当成锚点交上去**（留着它的坏法是安静的：卡上会变成
 *   "照片里的脸 + 示例里那个孩子的雨鞋"，而它看起来完全正常）。
 */
const EXAMPLE_TEXT: ReadonlyMap<AnchorSlot, string> = new Map(
  DEFAULT_ANCHORS.map((anchor) => [anchor.slot, anchor.value]),
)

/** 「补充」那一格的示例文字不来自 `DEFAULT_ANCHORS`（它预填的是空值，见那个文件） */
const EXTRA_EXAMPLE = '比如：左手腕内侧有一道浅疤、眉毛比一般人淡'

/**
 * ★ 2026-10-16：这里原来 re-export 了 `INTEREST_TAGS` / `LOOK_TAGS`（这两组标签住在
 *   `engine/domain.ts`）。两组标签的**手动编辑控件**在这一刀删掉了（见下面
 *   `ChildFields` 那段），于是**没有任何文件再从本文件 import 它们**——re-export 变成死的，
 *   删掉。清单本身一个字没动，仍在 `domain.ts`：`LOOK_TAGS` 还是读照片那条路的
 *   **允许集**（`openai-vision.ts` 用它把模型回的标签筛一遍），`childWordOf` 还靠它推
 *   "小男孩/小女孩"。**删的是控件，不是词汇表。**
 */

export function Field({
  label,
  hint,
  hintTone,
  required,
  tight,
  children,
}: {
  label: string
  hint?: string
  /**
   * 提示那一行用**强调色**（2026-10-18 第 29 刀）。
   *
   * ★ 用户："硬锚点弄成橙色，这样用户就知道这个是必填的了"。
   *   这条提示说的事**就是"必填"**——五条硬锚点空着，`checkAnchors` 会当场报
   *   「骨相是空的」，「出他的第一张形象」那颗按钮也就出不了图。所以它该与
   *   `.cf__req`（那个「必填」小字）**同色**：同一条意思，两种写法一个颜色。
   * ★ 只有硬锚点用得上它：软锚点空着不是问题（`normalizeAnchors` 丢空值之后卡照样合法）。
   */
  hintTone?: 'accent'
  required?: boolean
  /**
   * ★ 提示与标题**同行**（2026-10-15，用户："怎么这么长啊"）。
   *
   * 默认不这样：提示另起一行是给**窄**那一栏用的（创作流那一步只有一列宽，
   * 提示与标题挤一行会各自折成两行，反而更高）。`/character/new` 的右栏宽到
   * 放得下「头身比 · 硬锚点：每页都要对上」这一整行，于是每格省一行。
   * ★ 省下来的数是**实测**的，而且与窗口宽度无关：七条锚点每格 96 → 70px（第八格是 2026-10-16 加的，**那一档没有重新量过**），
   *   合计 782 → 490（`.out/probe-nc-height.mjs` 打印每格高与合计）。
   *   页面总高还受另两条影响——右栏够不够宽（够宽才排两列）、窄屏落不落成一栏——
   *   所以这里不引"总高多少"那一个数，它换个窗口就变了。
   *
   * ★ 提示的**文字与这里无关**（2026-10-16 起锚点那几格的提示只剩「硬锚点」/「软锚点」
   *   两个词）：这里只换它站的位置。把「硬锚点：每页都要对上」缩成「硬」再另写一份词表，
   *   是同一件事有两条真相，下一刀就会对不上。
   */
  tight?: boolean
  children: ReactNode
}) {
  const hintNode = hint ? (
    <span
      className={[
        tight ? 'cf__field-hint cf__field-hint--inline' : 'cf__field-hint',
        hintTone === 'accent' ? 'cf__field-hint--accent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {hint}
    </span>
  ) : null
  return (
    <label className="cf__field">
      <span className="cf__label">
        {label}
        {required && <span className="cf__req">必填</span>}
        {/* tight 时提示住进标题那一行；否则另起一行（挂在外层 label 上） */}
        {tight && hintNode}
      </span>
      {!tight && hintNode}
      {children}
    </label>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="cf__chip"
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/**
 * 「他是谁」那三格：名字、读音、年龄。
 *
 * ★ 三格必填的**意义**写在提示语里而不是校验里：多音字读错是家长第一秒就能发现的错
 *   （产品定义 Step 1），所以"名字怎么读"这一格的 hint 比它的校验更重要。
 *
 * ★ 2026-10-16（用户圈住「他长什么样」「他喜欢什么」两行："上面两行要填的，和下面的
 *   差不多，就把上面两行的内容删除了吧"）：两组标签的控件**整块删掉**，三个入口
 *   （`/character/new`、创作流第 1 步、孩子详情页的编辑表单）一起没有——它们是同一个组件。
 *   用户说的"和下面差不多"对**外貌**那行是准的：`LOOK_TAGS` 里 圆脸 / 小酒窝 这些词，
 *   下面的八条锚点里有更细的说法（骨相示例「圆脸、颊部饱满、下颌线软」、
 *   特征记号示例「右脸颊有一颗小酒窝」），而锚点才是形象唯一的判据。
 *   ★ 但**爱好**那行不是"重复"——它下面没有对应物，而且它是故事规划
 *   prompt 里唯一一处告诉模型"这孩子喜欢什么"的地方
 *   （`prompts/story-plan.ts` 的「爱好：…；至少让其中两项真的参与情节」）。
 *   删掉之后，新建的孩子 `interestTags` 就是**空**，那句话整条不再出现
 *   （空不算错：`book-api.ts` 的 `strList(undefined)` 回 `[]`，`profile.ts` 也写着
 *   "他没说喜欢什么"是合法状态）。**这是这一刀唯一一处真正丢了输入的地方**，
 *   已经报给用户；要收回来就是把这一段加回去（数据层一个字不用改）。
 *   ★ 两组标签**仍然有别的写入方**：`lookTags` 由读照片那条路写
 *   （`NewChild.tsx` 把 `payload.lookTags` 并进表单），存档与卡片墙也照旧读它。
 *   所以"控件没了"不等于"字段废了"——字段、清单、判据、prompt 全都留着。
 *
 * ★ 2026-10-16 第 23 刀加了**性别**那一行（用户："角色在增加一个选择性别的功能，
 *   这样前端生成的图片更加准确"）。它排在这一条的**末尾**而不是名字旁边：
 *   它是"选一下"的一行，与「年龄」同类，摆在四个输入框后面比插进名字与读音之间顺。
 *   ★ 它为什么不是可有可无的备注：这个值只做一件事——定下标准像提示词里那个**称呼**
 *   （小男孩 / 小女孩），而那个词决定模型画男孩还是画女孩。在此之前它是**从外貌标签推**的
 *   （`childWordOf` 看马尾/辫子/裙子），而两组标签的控件在同一个星期被删掉了，
 *   于是那条推断基本推不出东西。详见 `domain.ts` 的 `GENDERS`。
 *   ★ 两个选项、点一下就完事，所以它是**必填**（`childProblems` 那条）：
 *   让模型去猜这一格，是不必要地把一张脸的性别交给"头发长短"这一个词。
 *
 * ★ `pairName`（2026-10-15）：把**名字与读音并排**。默认不开，创作流那一屏的输出
 *   因此一个字节都没变——它那一列本来就窄，两格并排会挤。
 *   ★ 这一格值得单独说一句：`placeholder` 是「比如：小宇」而不是「小宇」。
 *   原来那两个字看着像**已经填好的值**，于是"新建角色"那一屏会出现
 *   「名字格里写着小宇，下面却说你还没填名字」这种同一屏自相矛盾
 *   （用户 2026-10-15 的截图里就是这个样子）。占位不删，因为读音那一格
 *   要示范格式，那是它唯一的用处。
 *
 * ★ 2026-10-16（用户："拼音怎么在键盘上根本打不出来啊"）：那条占位原来写的是
 *   「比如：yǔ」，hint 里的例子是「是 lè 还是 yuè」——**带声调的拼音在普通键盘上
 *   打不出来**（标调要么靠输入法候选栏里那几个变体，要么复制粘贴）。于是这一格
 *   示范了一个用户产不出来的格式，而它还是**必填**的。两处都改成不带声调的
 *   （`xiao yu` / `le` … `yue`）。
 *
 * ★ 这一改**不是放宽校验**：这一格从来没有格式校验，只判非空
 *   （`lib/children-body.ts` 与 `engine/character-card/profile.ts` 各判一次），
 *   带声调的写法一直也收——**改的只是示范**。它的唯一消费方是故事规划的 prompt
 *   （`prompts/story-plan.ts` 那句「名字念 …，别念错」），而那是给**文本模型**的
 *   指令，不带声调照样读得懂；多音字这条也大多不靠声调区分（乐 = `le` / `yue`
 *   本来就是两个写法，正是 hint 里那个例子想说的）。
 * ★ 另有一条欠着的：读音**对配音没有消费方**（`issues/08-voice.md` 记过），
 *   所以这一栏今天还改变不了"名字会被念错"这件事，那要接 SSML 音素控制。
 */
export function ChildFields({
  child,
  onPatch,
  extra,
  pairName,
}: {
  child: ChildForm
  onPatch: (patch: Partial<ChildForm>) => void
  /** 各入口想额外说的一句话（创作流用它说照片那一格的事，见 CreateFlow 里那段） */
  extra?: ReactNode
  /** 名字与读音并排（见上面那条注释；默认不并排） */
  pairName?: boolean
  /* ★ `tight` 这个 prop 随两组标签一起删了（2026-10-16）：它当时只作用在
     「他长什么样」「他喜欢什么」那两格的 hint 上（"提示与标题同行"）。
     剩下三格都不带 hint，留着它就是一个**没有任何效果**的开关——
     `AnchorFields` 自己那个 `tight` 不受影响，它还在用。 */
}) {
  const nameField = (
    <Field label="孩子的名字" required>
      <input
        className="cf__input"
        value={child.name}
        maxLength={20}
        placeholder="比如：小宇"
        onChange={(event) => onPatch({ name: event.target.value })}
      />
    </Field>
  )

  const readingField = (
    <Field
      label="名字怎么读"
      required
      hint="多音字最容易念错——「乐乐」是 le 还是 yue；声调打不打都行"
    >
      <input
        className="cf__input"
        value={child.nameReading}
        maxLength={20}
        placeholder="比如：xiao yu"
        onChange={(event) => onPatch({ nameReading: event.target.value })}
      />
    </Field>
  )

  return (
    <>
      {pairName ? (
        <div className="cf__pair">
          {nameField}
          {readingField}
        </div>
      ) : (
        <>
          {nameField}
          {readingField}
        </>
      )}

      <Field label="年龄" required>
        <div className="cf__chips">
          {AGE_BANDS.map((band) => (
            <Chip
              key={band}
              active={child.ageBand === band}
              onClick={() => onPatch({ ageBand: band })}
            >
              {/* 四档的说法在 domain.ts 里（`AGE_BAND_LABELS`）——一处定义，多处显示 */}
              {AGE_BAND_LABELS[band]}
            </Chip>
          ))}
        </div>
      </Field>

      {/* 性别（第 23 刀，理由见上面那条注释）。★ 两档都点不动"取消"：
          这一格是必填，选中的芯片再点一下仍然是它——`onPatch` 不是 `toggle`。
          `Chip` 那个组件在年龄那一行是同样用法（单选，不是多选） */}
      <Field label="性别" required>
        <div className="cf__chips">
          {GENDERS.map((gender) => (
            <Chip key={gender} active={child.gender === gender} onClick={() => onPatch({ gender })}>
              {GENDER_LABELS[gender]}
            </Chip>
          ))}
        </div>
      </Field>

      {extra}
    </>
  )
}

/**
 * 八条外貌锚点。槽位顺序来自 `ANCHOR_SLOTS`（声明序），**不在这里重排**：
 * 顺序是提示词与指纹的一部分（见 `card.ts` 的 `promptFragmentOf`）。
 *
 * ★ 第八格「补充」是家长自己写的（2026-10-16，用户："这应该有一个补充，家长可以对
 *   孩子的外貌再进行补充"）。它是 `ANCHOR_SLOTS` 里的一员，不是另造的一套机制——
 *   所以这里除了一行 `placeholder`（它没有预填值，空框总得有个说明）之外，
 *   一行特殊处理都没有：格子、顺序、校验、prompt、指纹全都跟着声明序自动走。
 *
 * ★ 提示语只剩「硬锚点」/「软锚点」两个词（2026-10-16，用户："每页都要对上，
 *   这句话也删除"）。原来的「硬锚点：每页都要对上」/「软锚点：允许合理变化」
 *   把**同一个意思念了两遍**：硬/软本身就是那个意思，而它的定义写在
 *   `ANCHOR_STRENGTH` 的注释里（"硬 = 一致性判定必须逐条核对；软 = 允许合理变化"）。
 *   ★ 保留那两个词是因为它**不是修辞**：它决定这一条会不会进一致性核对
 *     （`card.ts` 的 `promptFragmentOf` 只对硬锚点生成"是否一致"那一行），
 *     也决定空着算不算错（`checkAnchors`）。删掉它，家长就不知道"常服可以变"。
 *
 * ★ 2026-10-16 第 20 刀：这一组格子的**初始值是空的**，示例文字下沉成占位（灰）。
 *   预填值本身没删，`DEFAULT_ANCHORS` 一个字没动——它换了个位置出现（见 `EXAMPLE_TEXT`）。
 *   ★ 这条改动**只由 `/character/new` 的初始 state 决定**（那一屏不预填了），
 *   组件这边只是"空框也说得出该写什么"。要是哪天有第二屏也想预填，
 *   把值填进去就回到旧样子，这里一行都不用改。
 */
export function AnchorFields({
  anchors,
  onChange,
  tight,
}: {
  anchors: readonly { slot: (typeof ANCHOR_SLOTS)[number]; value: string }[]
  onChange: (anchors: { slot: (typeof ANCHOR_SLOTS)[number]; value: string }[]) => void
  /** 提示与标题同行（见 `Field` 的 `tight`；默认另起一行） */
  tight?: boolean
}) {
  const bySlot = new Map(anchors.map((anchor) => [anchor.slot, anchor.value]))
  return (
    <div className="cf__card-form">
      {ANCHOR_SLOTS.map((slot) => (
        <Field
          key={slot}
          label={ANCHOR_LABELS[slot]}
          hint={ANCHOR_STRENGTH[slot] === 'hard' ? '硬锚点' : '软锚点'}
          /* ★ 硬锚点那颗标注是**橙色**的（2026-10-18 第 29 刀，用户："硬锚点弄成橙色，
             这样用户就知道这个是必填的了"）。判据就在 `ANCHOR_STRENGTH` 上，不另立一张表：
             硬 = 空着会拦住出图（`checkAnchors` 只对硬锚点报「…是空的」）。 */
          hintTone={ANCHOR_STRENGTH[slot] === 'hard' ? 'accent' : undefined}
          tight={tight}
        >
          <input
            className="cf__input"
            value={bySlot.get(slot) ?? ''}
            /* ★ 八格**全都**有占位文字（2026-10-16 第 20 刀；在那之前只有「补充」这一格
               有，因为其余七格永远有预填值、空框不会出现——而 `/character/new` 现在
               不预填了，于是空框是常态，没有占位就是一个没有说明的白框）。
               ★ 占位是**灰的**、值是**黑的**，这条分界就是用户要的那件事：
               灰格子＝还没定（等你填），黑格子＝已经有锚点了。 */
            placeholder={slot === 'extra' ? EXTRA_EXAMPLE : EXAMPLE_TEXT.get(slot)}
            onChange={(event) => onChange(anchorsWith(anchors, slot, event.target.value))}
          />
        </Field>
      ))}
    </div>
  )
}
