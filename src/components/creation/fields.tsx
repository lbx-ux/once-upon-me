/**
 * fields.tsx —— 创作流那一套表单零件，抽出来给**两个**入口共用（工单 03 第二刀）
 *
 * 谁在用：
 *   - `CreateFlow.tsx` 的第 1 步（创作流里"孩子是谁"）
 *   - `studio/NewChild.tsx`（`/character/new` 那一屏）
 *
 * ★ 抽出来的理由不是"少写几行"，是**那一套判据与那几组选项只能有一份**：
 *   姓名/读音/年龄档这三个必填项、外貌与兴趣两组标签、七条锚点的槽位顺序，
 *   两处各写一遍的坏法是安静的——`/character/new` 多出一个 `'7+'` 的年龄档，
 *   或者少一个锚点槽位，而两边的界面都"看起来没问题"。
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

/** 外貌标签。★ 它决定 `childWordOf` 推出来的称呼（小女孩/小男孩/孩子），别随手加语义不清的 */
export const LOOK_TAGS = ['短发', '圆脸', '爱笑', '戴眼镜', '马尾', '小酒窝', '高个', '瘦小']
export const INTEREST_TAGS = ['恐龙', '画画', '足球', '小猫', '太空', '云', '船', '音乐']

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="cf__field">
      <span className="cf__label">
        {label}
        {required && <span className="cf__req">必填</span>}
      </span>
      {hint && <span className="cf__field-hint">{hint}</span>}
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
 * 「他是谁」那五格：名字、读音、年龄、外貌标签、兴趣标签。
 *
 * ★ 三格必填的**意义**写在提示语里而不是校验里：多音字读错是家长第一秒就能发现的错
 *   （产品定义 Step 1），所以"名字怎么读"这一格的 hint 比它的校验更重要。
 */
export function ChildFields({
  child,
  onPatch,
  extra,
}: {
  child: ChildForm
  onPatch: (patch: Partial<ChildForm>) => void
  /** 各入口想额外说的一句话（创作流用它说照片那一格的事，见 CreateFlow 里那段） */
  extra?: ReactNode
}) {
  return (
    <>
      <Field label="孩子的名字" required>
        <input
          className="cf__input"
          value={child.name}
          maxLength={20}
          placeholder="小宇"
          onChange={(event) => onPatch({ name: event.target.value })}
        />
      </Field>

      <Field label="名字怎么读" required hint="多音字最容易念错——「乐乐」是 lè 还是 yuè">
        <input
          className="cf__input"
          value={child.nameReading}
          maxLength={20}
          placeholder="yǔ"
          onChange={(event) => onPatch({ nameReading: event.target.value })}
        />
      </Field>

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

      <Field label="他长什么样" hint="多选，用来生成形象">
        <div className="cf__chips">
          {LOOK_TAGS.map((tag) => (
            <Chip
              key={tag}
              active={child.lookTags.includes(tag)}
              onClick={() => onPatch({ lookTags: toggle(child.lookTags, tag) })}
            >
              {tag}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="他喜欢什么" hint="多选，故事会用到">
        <div className="cf__chips">
          {INTEREST_TAGS.map((tag) => (
            <Chip
              key={tag}
              active={child.interestTags.includes(tag)}
              onClick={() => onPatch({ interestTags: toggle(child.interestTags, tag) })}
            >
              {tag}
            </Chip>
          ))}
        </div>
      </Field>

      {extra}
    </>
  )
}

/**
 * 七条外貌锚点。槽位顺序来自 `ANCHOR_SLOTS`（声明序），**不在这里重排**：
 * 顺序是提示词与指纹的一部分（见 `card.ts` 的 `promptFragmentOf`）。
 */
export function AnchorFields({
  anchors,
  onChange,
}: {
  anchors: readonly { slot: (typeof ANCHOR_SLOTS)[number]; value: string }[]
  onChange: (anchors: { slot: (typeof ANCHOR_SLOTS)[number]; value: string }[]) => void
}) {
  const bySlot = new Map(anchors.map((anchor) => [anchor.slot, anchor.value]))
  return (
    <div className="cf__card-form">
      {ANCHOR_SLOTS.map((slot) => (
        <Field
          key={slot}
          label={ANCHOR_LABELS[slot]}
          hint={ANCHOR_STRENGTH[slot] === 'hard' ? '硬锚点：每页都要对上' : '软锚点：允许合理变化'}
        >
          <input
            className="cf__input"
            value={bySlot.get(slot) ?? ''}
            onChange={(event) => onChange(anchorsWith(anchors, slot, event.target.value))}
          />
        </Field>
      ))}
    </div>
  )
}
