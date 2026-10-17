/**
 * book-api.ts —— 创作流那一次 `POST /api/books` 的**请求契约**（纯函数）
 *
 * 单独一个文件的理由：它是"浏览器传进来的东西"与"引擎的入参"之间唯一的关口。
 * 把关的代码写在 Route Handler 里，就只能靠手工发请求去测；写在这里，
 * 它可以被测试钉住（工单 09 §二 第 6 条：表单契约测试先行）。
 *
 * ★ 校验的**判据**来自引擎的领域类型，不另立一套：
 *   `ageBand` 必须落在 `AGE_BANDS` 里、`form` 必须落在 `BOOK_FORMS` 里——
 *   都是 import 过来判的。抄一份字面量进来，就是"两处定义迟早会漂"的最小样本
 *   （漂了以后的症状是：表单能选中的年龄档，引擎拒绝）。
 *
 * ★ 校验失败**一次报全部**，不是遇到第一个就返回。填表的人宁可一次看到三条，
 *   也不愿意改一条、提交、再看到下一条。
 */

import {
  AGE_BANDS,
  BOOK_FORMS,
  isGender,
  type AgeBand,
  type BookForm,
  type ChildProfile,
} from './engine/index.ts'

/** 草稿 / 成品。★ 判据的那一份在 `engine/domain.ts`（`Book.status` + `isDraft`） */
export type BookStatus = 'draft' | 'published'

export const BOOK_STATUSES: readonly BookStatus[] = ['draft', 'published']

/** 表单能提供的、以及 ADR-0008 要求的那几项 */
export type CreateBookBody = {
  child: ChildProfile
  /** 角色卡**按 id 引用**，不是把卡塞进请求体：卡是资产（ADR-0007），不是表单字段 */
  cardId: string
  cardRevision?: number
  theme: string
  wish?: string
  form: BookForm
  pages?: number
  /**
   * 这一本用哪个音色朗读（工单 02）。
   *
   * ★ **不填就是"这一本不配音"**——不是"用默认音色"。这一点是刻意的：
   *   引擎那边碰到没有 `voiceId` 会发一条非致命 error 如实说"这本书没有朗读"
   *   （`engine/index.ts`），而**默认音色是产品概念，不是引擎概念**（那行注释的原话）。
   *
   * ★ 这个字段曾经**整条缺席**：`CreateBookBody` 上没有它、`toBookBody()` 也不传，
   *   于是从界面做出来的每一本书，引擎收到的都是 `undefined`——
   *   一次朗读都没有过。加上它才是"接了"，在此之前那条线只是看着接上了。
   */
  voiceId?: string
  /**
   * 这一轮做出来的是一份**草稿**还是一本**成品**（工单 03）。
   * 不填 = 不写这个字段（见 `Book.status` 的迁移决定：缺省 = 成品）。
   */
  status?: BookStatus
  /**
   * provider 模式由调用方**声明**，不许 fallback 出来（providers/types.ts 的原话）。
   * 界面永远传 live；脚本与演示可以传 offline。
   */
  mode?: 'live' | 'offline'
  /**
   * ★ 这里原来有 `env?: Record<string, string | undefined>`（ADR-0008：用户在表单里
   * 填的模型与密钥随请求上来）。2026-10-17 之后它**整条退场**（ADR-0009）：
   * 密钥由站长分配，只从服务端的 `process.env` 来（`lib/settings/server-env.ts`）。
   *
   * ★ 这个字段是**删掉**的，不是"留着不用"：一个还在契约里的 `env` 会让下一个人
   * 以为"也许浏览器真的能指定密钥"，而那条路正是这一轮要关掉的东西。
   * 顺带，请求体里少了它，网络面板上就再也搜不到密钥这两个字。
   */
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problems: string[] }

const MAX_TAGS = 8
const MAX_TEXT = 200
/** 音色 id 的长度上界。见 `parseCreateBody` 里那段：它防的是"字段串了"，不是"名字太长" */
const MAX_VOICE_ID = 64

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strList(value: unknown, problems: string[], label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push(`${label}要是一个数组`)
    return []
  }
  const items = value.map(str).filter((item) => item !== '')
  if (items.length > MAX_TAGS) problems.push(`${label}最多 ${MAX_TAGS} 个，收到 ${items.length} 个`)
  return items.slice(0, MAX_TAGS)
}

export function parseCreateBody(raw: unknown): ParseResult<CreateBookBody> {
  const problems: string[] = []
  const body = asRecord(raw)
  if (!body) return { ok: false, problems: ['请求体要是一个 JSON 对象'] }

  const childRaw = asRecord(body['child'])
  if (!childRaw) problems.push('缺 child（孩子是谁这一步没填完）')

  const name = str(childRaw?.['name'])
  if (!name) problems.push('孩子的名字没填')
  else if (name.length > 20) problems.push('孩子的名字太长了（20 字以内）')

  // 读音是必填：产品定义 Step 1 说"读错家长第一秒就发现"（多音字）
  const nameReading = str(childRaw?.['nameReading'])
  if (!nameReading) problems.push('名字的读音没确认')

  const ageBandRaw = str(childRaw?.['ageBand'])
  const ageBand = AGE_BANDS.find((item) => item === ageBandRaw)
  if (!ageBand) problems.push(`年龄档要是 ${AGE_BANDS.join(' / ')} 之一`)

  const childId = str(childRaw?.['childId']) || slugOf(name)
  if (!childId) problems.push('childId 缺失（表单层要生成它：中文名推不出 slug，这里不替它编一个）')

  const formRaw = str(body['form'])
  const form = BOOK_FORMS.find((item) => item === formRaw)
  if (!form) problems.push(`形态要是 ${BOOK_FORMS.join(' / ')} 之一`)

  const cardId = str(body['cardId'])
  if (!cardId) problems.push('没选角色卡')

  const theme = str(body['theme'])
  if (!theme) problems.push('主题没选（或者自由输入的那一句是空的）')
  else if (theme.length > MAX_TEXT) problems.push('主题太长了（200 字以内）')

  const wish = str(body['wish'])
  if (wish.length > MAX_TEXT) problems.push('"想让他得到什么"太长了（200 字以内）')

  const pagesRaw = body['pages']
  let pages: number | undefined
  if (pagesRaw !== undefined && pagesRaw !== null && pagesRaw !== '') {
    const value = Number(pagesRaw)
    // 上界取 30：产品定义的独读版是 20 页，留一点余量给实验；
    // 下界取 3：两页成不了一本书，而"一本书至少三页"是引擎那边的形状决定的
    if (!Number.isInteger(value) || value < 3 || value > 30) {
      problems.push('页数要是 3 到 30 之间的整数')
    } else pages = value
  }

  const modeRaw = str(body['mode'])
  let mode: 'live' | 'offline' | undefined
  if (modeRaw) {
    if (modeRaw !== 'live' && modeRaw !== 'offline') problems.push('mode 只能是 live / offline')
    else mode = modeRaw
  }

  // 音色 id 是厂商侧的一个标识（`longjielidou_v3.6`、或克隆来的 voice_id）。
  // ★ 上界取 64：写长了必然是别的字段串进来了——而它会被原样送去 TTS 那边，
  //   报回来的错是"音色不存在"，与真正的问题（表单串了）隔着两层
  const voiceId = str(body['voiceId'])
  if (voiceId.length > MAX_VOICE_ID) {
    problems.push(`音色 id 太长了（${MAX_VOICE_ID} 字以内），多半是别的字段串进来了`)
  }

  const statusRaw = str(body['status'])
  const status = BOOK_STATUSES.find((item) => item === statusRaw)
  if (statusRaw && !status) problems.push(`status 只能是 ${BOOK_STATUSES.join(' / ')} 之一`)

  const lookTags = strList(childRaw?.['lookTags'], problems, '外貌标签')
  const interestTags = strList(childRaw?.['interestTags'], problems, '爱好标签')
  /**
   * 性别（2026-10-16 补）。★ **可选**，与 `ChildProfile.gender` 一致：没填是一个合法状态
   * （老档案、示例孩子都没有这一栏），那时称号退回按外貌标签推。
   *
   * ★ 它为什么必须进这张表：这个字段决定逐页 prompt 里的那个**称呼**
   *   （小男孩 / 小女孩），而称呼决定模型画男孩还是画女孩。
   *   原来 `toBookBody` 根本不送它——用户在界面上选的那一档，跑到引擎那边就不见了，
   *   于是"我提供给你的是男孩子，生成出来有男孩有女孩子"。
   */
  const genderRaw = str(childRaw?.['gender'])
  const gender = isGender(genderRaw) ? genderRaw : undefined
  if (genderRaw && !gender) problems.push('性别只能是 boy / girl（不填就是没选）')

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    value: {
      child: {
        childId,
        name,
        nameReading,
        ageBand: ageBand as AgeBand,
        ...(gender ? { gender } : {}),
        lookTags,
        interestTags,
      },
      cardId,
      ...(typeof body['cardRevision'] === 'number'
        ? { cardRevision: body['cardRevision'] as number }
        : {}),
      theme,
      ...(wish ? { wish } : {}),
      form: form as BookForm,
      ...(pages !== undefined ? { pages } : {}),
      ...(voiceId ? { voiceId } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(mode !== undefined ? { mode } : {}),
    },
  }
}

/**
 * 名字 → childId。
 *
 * ★ 中文名推不出像样的 slug，所以这条只是**兜底**：真正的 childId 由表单层生成
 *   （它知道这是第几个孩子）。兜底返回空串让上面的校验报错，比编一个
 *   `child-<时间戳>` 更好——时间戳会让同一个孩子每提交一次就多一个身份，
 *   而"跨书复用同一张卡"正是这个产品的主张之一。
 */
function slugOf(name: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(name) ? name.toLowerCase() : ''
}
