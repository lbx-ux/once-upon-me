/**
 * probe-gender-roundtrip.mjs —— 性别这一栏在**真路由 + 真磁盘**上的往返（2026-10-16 第 23 刀）
 *
 * 跑法（要有一个 dev server 在 3320；端口按你的隔离配置改）：
 *
 * ```bash
 * node scripts/probe-gender-roundtrip.mjs
 * ```
 *
 * ★ 它写进盘的只有两个**探针孩子**（名字叫「性别探针」），跑完自己删掉——
 *   删完还会回头确认文件真的不在了。所以它可以在一个有真实数据的库上跑。
 *
 * ★ 判据为什么选"写下去、从盘上读回来，是同一个值"而不是"页面上看得见"：
 *   芯片在页面上点亮只证明 React 状态，不证明这个值**进了档案**。而这一栏的
 *   唯一用途是喂给提示词，中间隔着三次序列化（请求体 → `parseChildBody` →
 *   `buildChildRecord` → 磁盘 → `toChildRecord`）。任何一次落掉，界面上都看不出来：
 *   档案里少一个键不会让任何一屏报错——这正是要打真路由的理由。
 * ★ 读**磁盘上的 JSON** 而不是 `/api/children` 的响应：那一条是给选择器用的
 *   窄投影（`listChildPicker` 只挑 childId/name/nameReading/ageBand/lookTags），
 *   它上面没有 gender 是设计如此，拿它当判据会把"投影窄"误判成"没存下来"。
 *   （第一版就是这么误判的。）
 * ★ 顺手验 PATCH 那条最阴的坏法：`profiles.save` 写的是**整条**记录，
 *   所以改名时不带 gender 就等于把性别擦了——界面因此必须每次都带上。
 * ★ 结束时把两个探针孩子删掉，并确认文件真的没了（删除凭据要报数）。
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:3320'
/** 与 `books-runtime.ts` 的 `DEFAULT_ASSET_ROOT` 同一处（`.out/web`） */
const CHILD_DIR = resolve('.out/web/children')

async function json(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 原样带着 text 报出来 */
  }
  return { status: res.status, parsed, text }
}

/** 盘上那一条原文。读不到回 null（"文件不在了"本身也是要报出来的事实） */
async function onDisk(childId) {
  if (!childId) return null
  try {
    return JSON.parse(await readFile(resolve(CHILD_DIR, `${childId}.json`), 'utf8'))
  } catch {
    return null
  }
}

const say = console.log
const base = {
  name: '性别探针',
  nameReading: 'tan zhen',
  ageBand: '4-6',
  lookTags: [],
  interestTags: [],
}

// ① 建两个：一个带 girl，一个不带这一栏（老档案的形状，盘上 `kid-3l98qv` 就是这样）
const withGender = await json('/api/children', 'POST', { ...base, gender: 'girl' })
const without = await json('/api/children', 'POST', base)
const idA = withGender.parsed?.childId
const idB = without.parsed?.childId
const diskA = await onDisk(idA)
const diskB = await onDisk(idB)
say(
  `A（带 gender=girl）建好了 ${idA} -> 盘上 gender=${JSON.stringify(diskA?.gender)} 键在=${Object.hasOwn(diskA ?? {}, 'gender')}`,
)
say(
  `B（不带这一栏）  建好了 ${idB} -> 盘上 gender=${JSON.stringify(diskB?.gender)} 键在=${Object.hasOwn(diskB ?? {}, 'gender')}`,
)

// ② 脏值不收，而且**不会有文件落下来**
const dirty = await json('/api/children', 'POST', { ...base, gender: '其他' })
say(
  `POST gender=「其他」 -> ${dirty.status} ${JSON.stringify(dirty.parsed?.message ?? dirty.text).slice(0, 90)}（返回的 childId=${JSON.stringify(dirty.parsed?.childId)}）`,
)

// ③ ★ 最阴的一条：改名时带不带这一栏，盘上分别是"还在"与"没了"
await json(`/api/children/${idA}`, 'PATCH', { ...base, name: '改过名字', gender: 'girl' })
const afterWith = await onDisk(idA)
await json(`/api/children/${idA}`, 'PATCH', { ...base, name: '再改一次' })
const afterWithout = await onDisk(idA)
say(
  `PATCH 带这一栏   -> 盘上 gender=${JSON.stringify(afterWith?.gender)} name=${JSON.stringify(afterWith?.name)}`,
)
say(
  `PATCH 不带这一栏 -> 盘上 gender=${JSON.stringify(afterWithout?.gender)} 键在=${Object.hasOwn(afterWithout ?? {}, 'gender')} name=${JSON.stringify(afterWithout?.name)}`,
)

// ④ 收摊：删掉两个探针孩子，并确认**文件真的不在了**
const gone = {}
for (const id of [idA, idB]) {
  if (!id) continue
  await json(`/api/children/${id}?impact=1`)
  const del = await json(`/api/children/${id}`, 'DELETE')
  gone[id] = { status: del.status, file: await onDisk(id) }
  say(`DELETE ${id} -> ${del.status} · 文件还在=${gone[id].file !== null}`)
}

const ok =
  withGender.status === 200 &&
  diskA?.gender === 'girl' &&
  Object.hasOwn(diskB ?? {}, 'gender') === false &&
  dirty.status === 400 &&
  dirty.parsed?.childId === undefined &&
  afterWith?.gender === 'girl' &&
  Object.hasOwn(afterWithout ?? {}, 'gender') === false &&
  Object.values(gone).every((g) => g.status === 200 && g.file === null)
say(
  `\n──── 判据 ────\n  ${ok ? '✓' : '✗'} 写下去盘上有、没选就没有这个键、脏值 400 且不落文件、` +
    `DELETE 之后文件真的不在了\n` +
    `  ★ 另有一条**量出来是坏事**的读数：PATCH 不带 gender = 把它擦了，\n` +
    `    所以界面那一边必须每次带上（\`ChildDetail.saveProfile\` 已经这么做了）\n`,
)
if (!ok) process.exitCode = 1
