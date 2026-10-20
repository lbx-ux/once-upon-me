/**
 * children-source.ts —— 一个孩子的档案从哪读：运行期档案，或随仓库提交的示例
 *
 * 与 `book-source.ts` 是同一个形状、同一条理由（"两个来源、一个函数"）：
 *
 * ```
 *   1. 运行期：ASSET_ROOT/children/<childId>.json     （家长自己建的）
 *   2. 预生成：public/demo/children/<childId>.json     （随仓库提交，断网也在）
 * ```
 *
 * 为什么示例孩子要有档案，而他们的卡资产曾经没有：
 *   档案是几行 JSON（名字、读音、年龄档），随仓库发布几乎没有代价；
 *   而示例孩子的卡本体是 327 / 357 KB 一张的 896×1200 JPEG（实测）。
 *   更要紧的是只发图是半件事——做一本书要用卡本体的字节去当参考图，
 *   光把图挂上去，示例孩子能看不能用。所以 2026-10-16 那一版只发了档案，
 *   2026-10-17 两样一起发了：`public/demo/cards/` 里是卡本体
 *   （`r1.<指纹>.json` + `ref.<指纹>.jpg` + `latest`，与运行期那一片同一套布局），
 *   由 `card-source.ts` 垫在每个用户那一片的底下——列得出来，也用得上
 *   （出图那一步读得到参考图字节，见那个文件头）。
 *   于是"有档案、没形象"现在只剩刚建档、还没出图这一种情形，
 *   而它照旧是一个正常的中间态，界面要如实显示它，不许拿别的图去顶。
 *
 * 服务端专用：它读文件系统。客户端拿到的是已经取好数的列表。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { assetRoot } from './books-runtime.ts'
import { createProfileStore } from './engine/character-card/profile-store.ts'
import { toChildRecord, type ChildRecord } from './engine/character-card/profile.ts'
import { createFsStore } from './engine/providers/stores.ts'

/** 预生成的示例档案在 `public/` 下的位置 */
export const DEMO_CHILDREN_DIR = 'demo/children'

export type ChildSource = 'runtime' | 'demo'

export type ResolvedChild = {
  profile: ChildRecord
  /** 这份档案是从哪读到的。★ 界面上"示例"那两个字由它决定，不由档案里的一个布尔字段决定——
   *  一个字段可以说谎（运行期复制了一份示例档案，它就自称不是示例了），来源不会
   */
  source: ChildSource
}

function demoDir(): string {
  return join(process.cwd(), 'public', DEMO_CHILDREN_DIR)
}

async function readProfilesIn(dir: string): Promise<ChildRecord[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: ChildRecord[] = []
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      // 形状不对就当它不在：这一层读的是文件，不能假定它是我们写的（toChildRecord 全函数）
      const record = toChildRecord(JSON.parse(await readFile(join(dir, name), 'utf8')))
      if (record) out.push(record)
    } catch {
      // 半截 JSON、权限问题——都当作"这个文件没东西"，不是让整页崩掉
    }
  }
  return out
}

/**
 * 全部孩子：自己的在前（按建档时间从新到旧），示例在后。
 *
 * 顺序在 2026-10-16 第 23 刀翻过来了（用户："用户生成的角色要放到默认角色的前面"）。
 *   原来写的是"两张示例卡在最前面"，当时当作产品要求；实际用起来，卡片墙上
 *   自己刚建的那个被挤到第二排去（那一屏第一眼要看的是"我的孩子"），
 *   示例是"先看看效果"的东西，排在后面才符合它的身份。
 *
 * "自己的按最近使用排序"仍然没有实现——现在没有任何地方记着
 *   "上次用这张卡是什么时候"（书里记的是出处，不是使用时间）。
 *   所以这一版是建档时间倒序，而它是个诚实的近似：家长刚建的那个就在前面。
 *   要真做"最近使用"，数据源是书架上每本书的 `createdAt` 与它的 `childId`——
 *   那是工单 03 剩下的活，写进"欠着的"。
 */
export async function listChildren(root: string = assetRoot()): Promise<ResolvedChild[]> {
  const store = createProfileStore(await createFsStore(root))
  // 目录还没建过时 `list()` 是空表（store 那一层吞掉了），所以这里不用 try
  const runtime = (await store.list()).map((profile) => ({ profile, source: 'runtime' as const }))
  const demo = await listDemoChildren()

  // 同 childId 时运行期那条赢：本机常常既有一份示例、又有一份家长自己建的（改过名字）
  const byId = new Map<string, ResolvedChild>()
  for (const item of [...demo, ...runtime]) byId.set(item.profile.childId, item)

  const all = [...byId.values()]
  return all.sort((a, b) => {
    // 自己的在前（第 23 刀翻过来的，理由见上面那段）：示例卡排在最后
    if (a.source !== b.source) return a.source === 'runtime' ? -1 : 1
    if (a.source === 'demo') return a.profile.childId.localeCompare(b.profile.childId)
    return b.profile.createdAt - a.profile.createdAt
  })
}

/**
 * 只有示例的那一份（来源一律是 `demo`），按 childId 排序。
 *
 * ★ 2026-10-18 抽出来，因为访客那一屏要的正是"来源是示例"这一条，而它不能
 *   靠 `listChildren(<示例根>)` 得到：那个函数里"运行期那一份"读的是 `<根>/children/`，
 *   而示例根底下正好就是同一批档案，于是同一份档案会以 `source: 'runtime'` 出现
 *   （同 id 时运行期赢）。翻面的后果不是好看不好看：卡片上"示例"两个字、
 *   以及"示例角色不给删"那颗按钮的判据，全都由这个字段决定。
 *
 * 所以"读示例那一份"只有这一处实现，`listChildren` 也用它。
 */
export async function listDemoChildren(): Promise<ResolvedChild[]> {
  const demo = (await readProfilesIn(demoDir())).map((profile) => ({
    profile,
    source: 'demo' as const,
  }))
  return demo.sort((a, b) => a.profile.childId.localeCompare(b.profile.childId))
}

/** 一个孩子。childId 不合法时回 null（不抛）：它来自 URL 那一段，那是用户输入 */
export async function childProfileOf(
  childId: string,
  root: string = assetRoot(),
): Promise<ResolvedChild | null> {
  const store = createProfileStore(await createFsStore(root))
  let mine: ChildRecord | null = null
  try {
    mine = await store.load(childId)
  } catch {
    // store 会挡目录穿越（见 profile-store 的文件头）。挡下来就是"没有这个孩子"
    return null
  }
  if (mine) return { profile: mine, source: 'runtime' }

  const demo = (await readProfilesIn(demoDir())).find((item) => item.childId === childId)
  return demo ? { profile: demo, source: 'demo' } : null
}

/**
 * 这个 childId 是不是随仓库发布的示例孩子（工单 03 第三刀）。
 *
 * 它存在的唯一理由是删除：示例孩子的档案在 `public/demo/` 里，那是仓库内容，
 *   运行期既不该删也删不掉（`public/` 在 Next 里是只读的静态目录）。
 *   而"删不掉却看起来删掉了"是最坏的一种：他名下的运行期卡会被删掉，
 *   档案却会在下一次列目录时**从 public/ 回来**——界面上就是"这个孩子回来了，
 *   但没有形象了"。所以删除那条路要在动手之前认出这类孩子并如实拒绝。
 * 判据是"这个 id 在示例里存在"，而不是"现在这份档案的来源是 demo"：
 *   本机常常既有示例的一份、又有家长覆盖的一份，而覆盖的那份删掉之后，
 *   露出来的仍然是示例那份——症状与上一条一模一样。
 */
export async function isDemoChildId(childId: string): Promise<boolean> {
  const demo = await readProfilesIn(demoDir())
  return demo.some((item) => item.childId === childId)
}
