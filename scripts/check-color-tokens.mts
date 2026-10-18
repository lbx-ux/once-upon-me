/**
 * check-color-tokens.mts —— 「面与墨」不许写死颜色（2026-10-18 配色审查 E2）
 *
 * 起因是审查里最刺眼的一条：`globals.css` 的文件头写着"**改配色只需动这一块**"，
 * 而全站**最常被看见的那些颜色**从来没进过令牌表——
 * 主按钮那四颗墨色药丸是字面量 `#1a1a20`（四处），书页纸是 `#fbf7ef`（五处），
 * 相纸的变体还散着 `#efe7db` / `#f2e9dc` / `#f6eddc`。它们与旁边的令牌
 * ΔE2000 全在 3.6 以内——**肉眼是同一个颜色，维护上是五个地方**。
 *
 * 于是那张"只需动这一块"的支票兑不了现，而且没人会发现：漏掉的颜色没有闸门。
 * 这支脚本就是那道闸门。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────
 *
 * 查这些属性：`color` / `background` / `background-color` / `border-color` /
 * `border-*-color` / `outline(-color)` / `fill` / `stroke` / `caret-color` /
 * `text-decoration-color` / `column-rule-color` / `accent-color`。
 * 命中条件有两条，**任一条成立就报**：
 *
 *   ① **不透明色值**（`#hex`、`rgb(r,g,b)`）—— 它一定是一个配色决定，
 *      没有任何"它取决于底下是什么"的借口。
 *   ② **某个令牌的颜色被当字面量写了**（`rgba(23,23,29,.2)` 里的 `23,23,29`
 *      就是 `--ink`）—— 这正是 `--accent-rgb` 那套 `-rgb` 伴生令牌存在的理由：
 *      "换配色时两个一起改"。写死一个数字，换配色时它就留在旧色上。
 *
 * ★ 判据 ② 是**按值比对**，不是按"看起来像"：脚本把 `globals.css` 里所有
 *   十六进制令牌读出来，逐个数 rgb 三分量。所以它不会把
 *   `rgba(255,255,255,.62)`（白的一张薄膜）误判成 `--surface`——
 *   但如果 `--surface` 就是 `#ffffff`，那它**确实**是同一个颜色被写死了，
 *   报出来是对的。
 *
 * **不查** `box-shadow` / `text-shadow` / `filter` / `mask*` / `background-image` /
 * `border-image` —— 那些是**光**，不是层级。
 * 它们本来就该用裸 rgba：全站 74 处阴影基色只有两支（`23,23,29` 与 `19,19,28`），
 * 彼此 ΔE ≤ 2.7，视觉上是同一个黑；把它们逐个令牌化只会让 CSS 变长、收益为零。
 *
 * ★ 这一条是我在审查报告里**收回**的一个建议：原来的措辞是"连 box-shadow 一起查"。
 *   写这支脚本时把 74 处逐个看过之后发现那条建议是错的——它会把一个不存在的问题
 *   变成一段很长的 allowlist。判据要落在**只有真做才会不同**的地方。
 *
 * `background` 是唯一一个两头都装的属性：平涂是"面"，`linear-gradient(...)` 是"光"。
 * 所以它按值判：含 `gradient(` 就跳过。
 *
 * ── 例外 ────────────────────────────────────────────────────────────────────
 *
 * `color-literals.allow.json` 记着已知且**说得通**的例外，每条必须带 `why`。
 * 例外是给"这一处写死了是对的"用的，不是给"来不及改"用的——
 * 前者要能讲清为什么令牌化它是错的（例：那颜色来自**图片**，跟设计令牌无关）。
 *
 * 用法：`npx tsx scripts/check-color-tokens.mts`
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIR = join(ROOT, 'src', 'components')
const ALLOW_PATH = join(ROOT, 'scripts', 'color-literals.allow.json')

/** 「面与墨」——这一组写死了就是绕过令牌表 */
const FACE_INK_PROPS = [
  'color',
  'background',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-block-color',
  'border-block-start-color',
  'border-block-end-color',
  'border-inline-color',
  'border-inline-start-color',
  'border-inline-end-color',
  /* ★ 简写也要查（2026-10-18 写这支脚本时补的）：一条 `border: 1px solid
     rgba(23, 23, 29, 0.13)` 是**描边色**，与 `border-color` 是同一件事——
     只查长写的话，全站最常见的那种写法（`border: … solid rgba(…, .1)`）
     整个从闸门底下走过去。补上之后多出来 13 处，其中 9 处是真的
     （`--ink` / `--surface` 被写成字面量），另 4 处的黑不属于任何令牌。 */
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-block',
  'border-block-start',
  'border-block-end',
  'border-inline',
  'border-inline-start',
  'border-inline-end',
  'outline',
  'outline-color',
  'fill',
  'stroke',
  'caret-color',
  'accent-color',
  'text-decoration-color',
  'column-rule-color',
] as const

/** 「光」——不查。理由见文件头 */
const LIGHT_PROPS = new Set([
  'box-shadow',
  'text-shadow',
  'filter',
  'mask',
  'mask-image',
  'background-image',
  'border-image',
  'border-image-source',
])

type AllowEntry = { file: string; literal: string; why: string }

type Hit = { file: string; line: number; prop: string; value: string; literals: string[] }

/**
 * 把 `/* … *\/` 注释整段抹成等长空白。
 * ★ 必须抹而不是"跳过含注释的行"：本仓库的注释**大量引用十六进制**
 *   （"原来是 `#faf5ee`"、"备选 `#8a6a2f` 只有 4.40"），那些是历史与依据，
 *   抹成空白才能既保住行号、又不把它们当成违规。等长替换 → 行号与列号都不动。
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 一行声明里有没有**写死的颜色**。`var(...)` / `currentColor` / `transparent` 都不算 */
function literalsIn(value: string): string[] {
  const found: string[] = []
  const hex = value.match(/#[0-9a-fA-F]{3,8}\b/g)
  if (hex) found.push(...hex)
  /* 报出来的是**整个色值**（`rgba(23,23,29,0.2)`），不是 `rgba(23` 这种半截：
     allowlist 里要按色值写，半截的键既难读又会互相撞。 */
  for (const m of value.matchAll(/\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g)) {
    found.push(m[0].replace(/\s+/g, ''))
  }
  for (const m of value.matchAll(/\bhsla?\(\s*\d+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,[^)]*)?\)/g)) {
    found.push(m[0].replace(/\s+/g, ''))
  }
  return found
}

/** `rgba(23,23,29,0.2)` → `23,23,29`；`#f7f7f8` → `247,247,248`。用于与令牌比色 */
function tripleOf(literal: string): string | null {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(literal)
  if (hex) {
    return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).join(',')
  }
  const rgb = /^rgba?\((\d+),(\d+),(\d+)/.exec(literal)
  return rgb ? `${rgb[1]},${rgb[2]},${rgb[3]}` : null
}

async function* cssFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* cssFiles(full)
    else if (entry.name.endsWith('.css')) yield full
  }
}

/** 相对仓库根的 posix 路径——allowlist 里写的就是这个，跨平台一致 */
function rel(full: string): string {
  return relative(ROOT, full).split(sep).join('/')
}

const allow: AllowEntry[] = JSON.parse(await readFile(ALLOW_PATH, 'utf8')) as AllowEntry[]
const allowed = new Set(allow.map((a) => `${a.file}\u0000${a.literal}`))

/**
 * `globals.css` 里所有十六进制令牌的 rgb 三分量。
 * ★ 只取**十六进制**：半透明的令牌（`--surface-soft` 那种 rgba）本来就是
 *   "压在什么上就是什么"，把它算成"一个颜色"会把判据搞浑。
 */
const TOKEN_TRIPLES = new Map<string, string>()
{
  const globals = await readFile(join(ROOT, 'src', 'app', 'globals.css'), 'utf8')
  for (const m of stripComments(globals).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, hex] = m
    TOKEN_TRIPLES.set(tripleOf(hex!)!, name!)
  }
}

/** 这个字面量算不算"绕过令牌表"（两条判据见文件头） */
function isViolation(literal: string): boolean {
  const triple = tripleOf(literal)
  const opaque = literal.startsWith('#') || /^rgb\(/.test(literal)
  if (opaque) return true
  return triple !== null && TOKEN_TRIPLES.has(triple)
}

const hits: Hit[] = []
for await (const full of cssFiles(SCAN_DIR)) {
  const stripped = stripComments(await readFile(full, 'utf8'))
  const lines = stripped.split('\n')

  /* 多行声明（`background:\n  linear-gradient(…)`）要把续行拼回来，
     否则第一行只剩 `linear-gradient(`、判不出这是"光"。拼接只用于**判值**，
     报出来的行号仍是 `prop:` 那一行。 */
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([a-z-]+)\s*:\s*(.*)$/.exec(lines[i]!)
    if (!m) continue
    const prop = m[1]!
    if (LIGHT_PROPS.has(prop)) continue
    if (!(FACE_INK_PROPS as readonly string[]).includes(prop)) continue

    let value = m[2]!
    /* 续行：本行不以 `;` 收尾且下一行是缩进的属性值（不是新的选择器） */
    let j = i
    while (!/;\s*$/.test(value) && j + 1 < lines.length) {
      const next = lines[j + 1]!
      if (/^\s*[.#a-zA-Z[\]:]/.test(next) && !/^\s/.test(next)) break
      j++
      value += ' ' + lines[j]!.trim()
      if (j - i > 40) break
    }

    /* `background` 是唯一两头都装的属性：渐变是光，平涂是面 */
    if ((prop === 'background' || prop === 'background-color') && /gradient\(/.test(value)) {
      continue
    }
    /* 只剩别的东西（url()、none、var()）的行不算 */
    const lits = literalsIn(value)
      .filter(isViolation)
      .filter((l) => !allowed.has(`${rel(full)}\u0000${l}`))
    if (lits.length === 0) continue
    hits.push({ file: rel(full), line: i + 1, prop, value: value.trim(), literals: lits })
  }
}

/**
 * ── `--fix`：把"某颗令牌的颜色被写成字面量"这一类自动改回去 ────────────────
 *
 * ★ 为什么把"改"放进"查"这支脚本里，而不是另写一支：判据只能有一份。
 *   另写一支就得把"哪些属性算面与墨、续行怎么拼、注释怎么抹"再抄一遍，
 *   两份判据迟早漂移——那时"闸门说我错了、改法说我是对的"是最坏的处境。
 *
 * ★ 它只做**机械的那一半**：`rgba(23,23,29,.2)` → `rgba(var(--ink-rgb),.2)`，
 *   映射由 `TOKEN_TRIPLES` 按值反查得出，不需要人写对应表。
 *   不透明色（`#fffdf7`）**不动**——那要人来决定它该归哪一颗令牌
 *   （"这张纸是哪一颗"是个设计判断，不是查表），所以它只报不改。
 */
if (process.argv.includes('--fix')) {
  const byFile = new Map<string, Hit[]>()
  for (const h of hits) (byFile.get(h.file) ?? byFile.set(h.file, []).get(h.file)!).push(h)

  let fixed = 0
  const undecided: Hit[] = []
  for (const [file, fileHits] of byFile) {
    const abs = join(ROOT, file)
    const src = await readFile(abs, 'utf8')
    const lines = src.split('\n')
    for (const h of fileHits) {
      let line = lines[h.line - 1]!
      for (const literal of h.literals) {
        const triple = tripleOf(literal)
        const tokenName = triple ? TOKEN_TRIPLES.get(triple) : undefined
        /* 不透明的、或者反查不到令牌的：报出来等人决定 */
        if (!tokenName || literal.startsWith('#') || /^rgb\(/.test(literal)) {
          undecided.push(h)
          continue
        }
        const alpha = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(literal)?.[1] ?? '1'
        const replacement = `rgba(var(--${tokenName}-rgb), ${alpha})`
        const before = line
        /* 原行里的空格与报出来的紧凑形式不一样，所以按"分量"找 */
        const loose = new RegExp(
          `rgba\\(\\s*${triple!.split(',').join('\\s*,\\s*')}\\s*,\\s*${alpha.replace('.', '\\.')}\\s*\\)`,
        )
        line = line.replace(loose, replacement)
        if (line !== before) fixed++
        else undecided.push(h)
      }
      lines[h.line - 1] = line
    }
    const out = lines.join('\n')
    if (out !== src) await writeFile(abs, out, 'utf8')
  }
  console.log(`\n--fix：改了 ${fixed} 处（某颗令牌的颜色被写成字面量）。`)
  if (undecided.length > 0) {
    console.log(
      `\n还有 ${undecided.length} 处**要人决定**（不透明色，或反查不到对应令牌）：\n` +
        undecided.map((h) => `  ${h.file}:${h.line}  ${h.literals.join(' ')}`).join('\n') +
        `\n\n  ★ 这些是"这张纸是哪一颗"一类的问题，脚本不替你答。`,
    )
  }
  process.exit(0)
}

if (hits.length === 0) {
  console.log(
    `\nPASS：「面与墨」上没有写死的颜色（扫了 ${
      (await Array.fromAsync(cssFiles(SCAN_DIR))).length
    } 个组件样式表，${allow.length} 条例外带理由）。\n` +
      `      ★ 例外只给"写死了是对的"用，不给"来不及改"用。\n`,
  )
  process.exit(0)
}

console.log(`\nFAIL：${hits.length} 处「面与墨」写死了颜色 —— 令牌表管不到它们。\n`)
for (const h of hits) {
  console.log(`  ${h.file}:${h.line}`)
  console.log(`     ${h.prop}: ${h.value}`)
  console.log(`     写死的颜色：${h.literals.join(' ')}`)
}
console.log(
  `\n  ★ 改法：在 globals.css 的 :root 里加一颗令牌，这里换成 var(--x)。\n` +
    `    若"写死是对的"（例如那个值来自一张图片，与设计令牌无关），\n` +
    `    把它连同理由写进 scripts/color-literals.allow.json。\n`,
)
process.exit(1)
