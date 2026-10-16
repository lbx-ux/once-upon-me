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
 * ★ class 名仍然是 `cf__*`（创作流那一套）：`create-flow.css` 在 `globals.css` 里
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
} from '@/lib/engine/domain.ts'
import { anchorsWith } from '@/lib/creation/default-anchors.ts'
import type { ChildForm } from '@/lib/creation/state.ts'

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
  required,
  tight,
  children,
}: {
  label: string
  hint?: string
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
    <span className={tight ? 'cf__field-hint cf__field-hint--inline' : 'cf__field-hint'}>
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
          tight={tight}
        >
          <input
            className="cf__input"
            value={bySlot.get(slot) ?? ''}
            /* ★ 只有"补充"这一格给占位：其余七格有预填值，空框不会出现 */
            placeholder={
              slot === 'extra' ? `比如：左手腕内侧有一道浅疤、眉毛比一般人淡` : undefined
            }
            onChange={(event) => onChange(anchorsWith(anchors, slot, event.target.value))}
          />
        </Field>
      ))}
    </div>
  )
}
