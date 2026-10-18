/**
 * wait-copy.ts —— 四件"要等"的活，各说什么话（纯函数，无 React）
 *
 * ★ 为什么要有这么一个文件：这四件活落在**两个屏幕**上（`/character/new` 与
 *   `/character/<childId>`），而 2026-10-18 那一刀之前，它们的"正在干什么"
 *   是各处自己拼的——右上角一份、左栏一份、详情页那一屏**一个字都没有**。
 *   用户的原话是「现在这个 ai 分析锚点和制作人物的 ai 制作过程好不明显，
 *   用户有时候都没发现你在制作」。
 *   ★ 判据是"**这几句话必须一模一样地出现在原地与弹窗里**"（原地那一行在弹窗
 *     被收起之后还在），所以它只能是**一份**。写在纯模块里，顺带能在 node 里钉住
 *     （`wait-copy.test.ts`）。
 *
 * ## 四件活，以及**为什么有的活没有三步**
 *
 * | 活 | 请求 | 几步 | 时长 |
 * | --- | --- | --- | --- |
 * | `analyze` 读照片（`/api/cards/analyze-photo`） | 1 次 | 三步（照片已选好 / 正在读 / 填进那几格） | 实测约 45 s |
 * | `draw` 出他的第一张形象（`/api/children` → `/api/cards`） | **2 次** | 三步 | 建档一瞬 + 出图约 24 s |
 * | `revise` 重画一版（`/api/cards/revise`） | 1 次 | **没有** | 十几秒 |
 * | `first` 给已有档案出第一张（`/api/cards`） | 1 次 | **没有** | 十几秒 |
 *
 * ★ **三步那两件不是凑的**：三步里每一步都对应一个真事件——
 *   `analyze` 是「照片选好了」（真事件）、「请求在飞」（真事件）、「把读到的填进那几格」
 *   （**接下来会发生的事**，写出来是因为用户此刻最想知道的正是"等这么久，等的是什么"）；
 *   `draw` 是两次真请求加一次落地（`stage` 说现在在哪一段）。
 * ★ 反过来，**只有一次请求的活就不许有三步**：给 `revise` 编一条"正在理解你的建议"
 *   是编进度，而这个项目里"编出来的东西比没有更糟"。于是它只有标题 + 那一句轮播的
 *   "还在办" + 一句实话。**这条判据有测试**（`revise` / `first` 的 `steps` 必须是空的）。
 *
 * ★ 三句话的纪律**没有变**（原来写在 `NewChild.tsx` 的 `useRotatingLine` 上，搬过来了）：
 *   只说"还在办"，不说"办到哪儿了"。不许出现百分比、秒数、模型内部状态。
 */

export const WAIT_JOBS = ['analyze', 'draw', 'revise', 'first'] as const

export type WaitJob = (typeof WAIT_JOBS)[number]

/**
 * 读照片那几秒（`POST /api/cards/analyze-photo`，实测约 45 秒）。
 *
 * ★ 它替掉的是**秒数**（曾经有过一版"已等 N 秒"）。换掉的是一条**真的**读数，
 *   换成几句话——所以这几句有一条纪律：**只说"还在办"，不说"办到哪儿了"**。
 *   - 可以说：加急、在等、快好了——它们不承诺任何具体的进度或时刻；
 *   - 不许说：「已经画好 80%」「还剩 10 秒」「正在检查五官」——那几句要么是编的进度，
 *     要么是在讲模型内部的状态，而我们**看不到**它（这个请求一次性回包）。
 */
const READ_LINES = [
  '正在加急处理中',
  '正在一格一格地看这张照片',
  '正在把看到的东西记下来',
  '快好了，再等一小会儿',
] as const

/** 出图那几十秒（`POST /api/cards` / `/api/cards/photo`，实测约 24 秒） */
const DRAW_LINES = [
  '正在加急处理中',
  '正在铺底色',
  '正在一点点上色',
  '快好了，再等一小会儿',
] as const

/** 一步的状态。★ 只有三档，`todo` 那一档是**还没发生的事**（画成空圈） */
export type WaitStepState = 'done' | 'now' | 'todo'

export type WaitStep = { text: string; state: WaitStepState }

export type WaitCopy = {
  /** 这一张纸的标题：用家长的话说"现在在干什么" */
  title: string
  /** 三步（可能是空的，见文件头那张表）。空 = 这一件活凑不出三步 */
  steps: readonly WaitStep[]
  /** 轮着播的几句。★ 由 `useRotatingLine` 播，节奏在它那儿（每句 8 秒） */
  lines: readonly string[]
  /**
   * 一句**必须说**的实话：收起之后它还在跑，而且**不用你自己来刷新**。
   *
   * ★ 为什么必须有：这一张纸能被收起（Esc / 点遮罩 / 那颗「收起」），而**收起 ≠ 取消**
   *   ——请求已经在飞，服务端那边照样在花钱、照样会写出结果。不说这一句，
   *   收起就会被读成"停了"，而那是一件我们做不到的事。
   * ★ 2026-10-18 第 30 刀，**这两句是用户逐字给的**（原来那两句是「这一步停不下来
   *   ——收起来它照样在跑，…」）：
   *   - 画图那三件活：「先收起也没关系，它会继续重画；完成后页面会自动更新。」
   *   - 读照片那一件：「可以先收起，照片还在识别；识别完成后右侧表单会自动填好。」
   *   换的不只是口气，还**多答了一个问题**：收起来之后我要不要自己刷新一次?
   *   那句"会自动更新 / 会自动填好"就是答它的——而这句是**真的**：
   *   画图那三件活成功之后由 `ChildDetail` / `NewChild` 自己把结果换上来
   *   （`ChildDetail` 还为此多了个"正在把它换上来…"的中间态，见那个文件的 `Arriving`），
   *   读照片那一件则把七格锚点直接填进右边那张表单——两件事都不用刷。
   */
  aside: string
}

export type WaitFacts = {
  /**
   * `draw` 那件活现在走到哪一段了：`profile` = 正在 `POST /api/children`（存档案），
   * `image` = 档案已经存好了，正在出图。
   * ★ 一步到位的活**不要传**（传了也没人读）。
   */
  stage?: 'profile' | 'image'
  /** 「照片已选好（0.3 MB）」里那个大小。★ 只有 `analyze` 用得到 */
  photoSize?: string
}

/**
 * 那三件"画图"的活（`draw` / `revise` / `first`）共用的那一句实话。
 *
 * ★ 为什么是一个常量而不是抄三遍：三件活是**同一件事**（在等一张图），
 *   抄三遍就会在下次改文案时漏掉一份——而这一句正是"收起 ≠ 取消"唯一的出口。
 *   用户 2026-10-18 给的也正是**一句**（「修改图片和创作图片」）。
 */
const IMAGE_ASIDE = '先收起也没关系，它会继续重画；完成后页面会自动更新。'

/** 读照片那一件的那一句（同上，用户逐字给的） */
const READ_ASIDE = '可以先收起，照片还在识别；识别完成后右侧表单会自动填好。'

/**
 * 那四件活各说什么。
 *
 * ★ 标题只说**这件活的名字**，不说进度（进度是 `steps` 的事）：
 *   `draw` 在 `stage === 'profile'` 时标题也照样是"正在出他的第一张形象"——
 *   那时候正在做的其实是存档案，而**第一步的圆点是亮的**，它就在标题底下说这件事。
 */
export function waitCopyOf(job: WaitJob, facts: WaitFacts = {}): WaitCopy {
  switch (job) {
    case 'analyze':
      return {
        title: '正在读这张照片',
        steps: [
          {
            // ★ 大小是**已知的事实**（`File.size` 就在手上），不是编的进度
            text: `照片已选好${facts.photoSize ? `（${facts.photoSize}）` : ''}`,
            state: 'done',
          },
          { text: '模型正在读这张照片', state: 'now' },
          { text: '把读到的填进右边那几格', state: 'todo' },
        ],
        lines: READ_LINES,
        aside: READ_ASIDE,
      }
    case 'draw': {
      const image = facts.stage === 'image'
      return {
        title: '正在出他的第一张形象',
        steps: [
          {
            text: image ? '档案存好了' : '正在存他的档案',
            state: image ? 'done' : 'now',
          },
          {
            text: image ? '正在画他的第一张形象' : '画他的第一张形象',
            state: image ? 'now' : 'todo',
          },
          { text: '画好了给你看', state: 'todo' },
        ],
        /* ★ 存档案那一段**不播**（2026-10-16 第 21 刀定的，第 28 刀照旧）：
           `POST /api/children` 是一百毫秒级的本地写，不是"在等模型"——
           冲它说一句「正在加急处理中」是把一件不慢的事说成慢的。
           空数组 = 那一段一个字都不说（`useRotatingLine([])` 回空串，
           `WaitSteps` 那边 `say` 为空就什么都不画）。 */
        lines: image ? DRAW_LINES : [],
        aside: IMAGE_ASIDE,
      }
    }
    case 'revise':
      return {
        title: '正在按你写的那一句重画',
        // ★ 一次请求，凑不出三步——见文件头那条判据
        steps: [],
        lines: DRAW_LINES,
        aside: IMAGE_ASIDE,
      }
    case 'first':
      return {
        title: '正在出他的第一张形象',
        steps: [],
        lines: DRAW_LINES,
        aside: IMAGE_ASIDE,
      }
  }
}
