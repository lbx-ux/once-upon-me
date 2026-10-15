/**
 * children-source.ts —— 一个孩子的档案**从哪读**：运行期档案，或随仓库提交的示例
 *
 * 与 `book-source.ts` 是同一个形状、同一条理由（"两个来源、一个函数"）：
 *
 * ```
 *   1. 运行期：ASSET_ROOT/children/<childId>.json     （家长自己建的）
 *   2. 预生成：public/demo/children/<childId>.json     （随仓库提交，断网也在）
 * ```
 *
 * ★ 为什么示例孩子要有档案，而他们的**卡资产**还没有：
 *   档案是几行 JSON（名字、读音、年龄档），随仓库发布几乎没有代价；
 *   而示例孩子的卡本体是 2.7 MB 一张的 1440² PNG（实测），两张就是 5.6 MB。
 *   更要紧的是**只发图是半件事**——做一本书要用卡本体的字节去当参考图，
 *   光把图挂上去，示例孩子能看不能用。所以这一版只发档案，
 *   卡资产那条路（含缩略档）记在工单 03 的"欠着的"里，与工单 10 的缩略图梯子一起做。
 *   ★ 于是"有档案、没形象"是一个**正常的中间态**，界面要如实显示它，
 *   而不是拿一张示例图去顶（顶了就是给不存在的数据源背书）。
 *
 * ★ 服务端专用：它读文件系统。客户端拿到的是**已经取好数的列表**。
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
  /** 这份档案是从哪读到的。★ 界面上"示例"那两个字由**它**决定，不由档案里的一个布尔字段决定——
   *  一个字段可以说谎（运行期复制了一份示例档案，它就自称不是示例了），来源不会 */
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
      // 形状不对就当它不在：这一层读的是**文件**，不能假定它是我们写的（toChildRecord 全函数）
      const record = toChildRecord(JSON.parse(await readFile(join(dir, name), 'utf8')))
      if (record) out.push(record)
    } catch {
      // 半截 JSON、权限问题——都当作"这个文件没东西"，不是让整页崩掉
    }
  }
  return out
}

/**
 * 全部孩子：示例在前，自己的在后（自己的按建档时间从新到旧）。
 *
 * ★ "两张示例卡在最前面"是产品要求；"自己的按最近使用排序"**没有实现**——
 *   现在没有任何地方记着"上次用这张卡是什么时候"（书里记的是出处，不是使用时间）。
 *   所以这一版是**建档时间倒序**，而它是个诚实的近似：家长刚建的那个就在前面。
 *   要真做"最近使用"，数据源是书架上每本书的 `createdAt` 与它的 `childId`——
 *   那是工单 03 剩下的活，写进"欠着的"。
 */
export async function listChildren(root: string = assetRoot()): Promise<ResolvedChild[]> {
  const store = createProfileStore(await createFsStore(root))
  // 目录还没建过时 `list()` 是空表（store 那一层吞掉了），所以这里不用 try
  const runtime = (await store.list()).map((profile) => ({ profile, source: 'runtime' as const }))
  const demo = (await readProfilesIn(demoDir())).map((profile) => ({
    profile,
    source: 'demo' as const,
  }))

  // 同 childId 时运行期那条赢：本机常常既有一份示例、又有一份家长自己建的（改过名字）
  const byId = new Map<string, ResolvedChild>()
  for (const item of [...demo, ...runtime]) byId.set(item.profile.childId, item)

  const all = [...byId.values()]
  return all.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'demo' ? -1 : 1
    if (a.source === 'demo') return a.profile.childId.localeCompare(b.profile.childId)
    return b.profile.createdAt - a.profile.createdAt
  })
}

/** 一个孩子。childId 不合法时回 null（**不抛**）：它来自 URL 那一段，那是用户输入 */
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
 * 这个 childId 是不是**随仓库发布**的示例孩子（工单 03 第三刀）。
 *
 * ★ 它存在的唯一理由是删除：示例孩子的档案在 `public/demo/` 里，那是**仓库内容**，
 *   运行期既不该删也删不掉（`public/` 在 Next 里是只读的静态目录）。
 *   而"删不掉却看起来删掉了"是最坏的一种：他名下的运行期卡会被删掉，
 *   档案却会在下一次列目录时**从 public/ 回来**——界面上就是"这个孩子回来了，
 *   但没有形象了"。所以删除那条路要在**动手之前**认出这类孩子并如实拒绝。
 * ★ 判据是"**这个 id 在示例里存在**"，而不是"现在这份档案的来源是 demo"：
 *   本机常常既有示例的一份、又有家长覆盖的一份，而覆盖的那份删掉之后，
 *   露出来的仍然是示例那份——症状与上一条一模一样。
 */
export async function isDemoChildId(childId: string): Promise<boolean> {
  const demo = await readProfilesIn(demoDir())
  return demo.some((item) => item.childId === childId)
}
