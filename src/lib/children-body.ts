/**
 * children-body.ts —— "这段请求体算不算一份孩子的档案"，**唯一那一处判据**
 *
 * 为什么单独一个文件：新建（`POST /api/children`）与改名（`PATCH /api/children/<id>`）
 * 收的是**同一份东西**——名字、读音、年龄档、两组标签。
 * 各写一遍的症状很具体：一边改了"读音可以留空"，另一边没改，
 * 于是同一个表单在新建那一屏能过、在详情页 400，而两句错误文案长得一模一样，
 * 没人会怀疑是校验分了两份。这与 `cards-list.ts`、`children-list.ts`
 * 当初被抽出来的理由是同一条（"同一件事只写一遍"）。
 *
 * ★ 这里只做**"收不收"**这一层：JSON 的形状、三个必填项非空。
 *   名字合不合法、年龄档在不在 `AGE_BANDS` 里，那些是**引擎**的事
 *   （`profile.ts` 的 `validateChildRecord` / `buildChildRecord`），
 *   这一层不重写一遍——重写的那份迟早比引擎宽松或比引擎苛刻。
 */

export type ChildBody = {
  name: string
  nameReading: string
  ageBand: string
  lookTags: string[]
  interestTags: string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter((item) => item !== '')
}

export function parseChildBody(raw: unknown): { body?: ChildBody; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { problems: ['请求体要是一个 JSON 对象'] }
  }
  const source = raw as Record<string, unknown>
  const body: ChildBody = {
    name: text(source['name']),
    nameReading: text(source['nameReading']),
    ageBand: text(source['ageBand']),
    lookTags: textList(source['lookTags']),
    interestTags: textList(source['interestTags']),
  }
  // ★ 这三条与 `creation/state.ts` 的 `stepProblems('child')` **是同一批判据**。
  //   这里再写一遍不是重复：那边是"界面上的下一步要不要禁用"，这边是"这段请求能不能收"，
  //   而只有后者能挡住一个绕过界面的请求。名字/读音/年龄档的意义见 profile.ts
  const problems: string[] = []
  if (body.name === '') problems.push('孩子的名字还没填')
  if (body.nameReading === '') problems.push('名字的读音还没确认')
  if (body.ageBand === '') problems.push('年龄档没选')
  return problems.length > 0 ? { problems } : { body, problems: [] }
}
