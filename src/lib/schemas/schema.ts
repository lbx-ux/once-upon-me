/**
 * schema.ts —— 结构化输出的校验器 + JSON Schema 生成器（自写，约 150 行）
 *
 * 为什么不引 zod：ADR-0004 与 tech-selection §1 定的是"自写结构化输出校验与重试"。
 * 真正的理由不是省一个依赖，是这里只有**一个**需求：把模型吐出来的 JSON
 * 变成可信的领域对象，并在失败时说得出"哪一条不对"好让重试提示有的可写。
 * zod 能做得更好，但那是"以后如果字段多了再说"——现在它是多一个运行时依赖换 8 个组合子。
 *
 * ★ 一份定义，两个用途：
 *   `describe()` 出 JSON Schema（喂给模型的 json_schema 档），
 *   `parse()` 出校验结果（拿到模型的输出之后）。
 *   分成两份定义迟早会漂——漂了的症状是"我们告诉模型要 A，却按 B 验收"，
 *   然后通过率莫名偏低，查半天查到的是两份定义不一致。
 *
 * ★ 错误必须带路径（`pages[3].mood`）：重试提示里没有具体路径，
 *   就等于让模型重新猜一遍，通过率不会变，钱多花一次。
 */

export type JsonSchemaNode = Record<string, unknown>

export type ParseFailure = { path: string; message: string }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; failures: ParseFailure[] }

/** 一个字段的两副面孔：运行时校验 + 给模型看的描述 */
export type Codec<T> = {
  parse(value: unknown, path: string): ParseResult<T>
  describe(): JsonSchemaNode
  /** 可选包装用：内部是否已有默认值等。目前只有 object 需要它 */
  readonly kind: string
}

export function string(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Codec<string> {
  return {
    kind: 'string',
    parse(value, path) {
      if (typeof value !== 'string') return fail(path, `应为字符串，实际是 ${typeName(value)}`)
      const trimmed = value.trim()
      if (opts.min !== undefined && trimmed.length < opts.min) {
        return fail(path, `过短（${trimmed.length} < ${opts.min}）`)
      }
      if (opts.max !== undefined && trimmed.length > opts.max) {
        return fail(path, `过长（${trimmed.length} > ${opts.max}）`)
      }
      if (opts.pattern && !opts.pattern.test(trimmed))
        return fail(path, `格式不符：${opts.pattern}`)
      return ok(trimmed)
    },
    describe() {
      const node: JsonSchemaNode = { type: 'string' }
      if (opts.min !== undefined) node['minLength'] = opts.min
      if (opts.max !== undefined) node['maxLength'] = opts.max
      return node
    },
  }
}

/**
 * 字符串数组，逐条 trim 后丢掉空串。正文一句一段就靠它，空串会让排版出现空气泡。
 *
 * `itemMax` 是**每条**的字数上限（一句正文超过 120 字就不像读给孩子听的了）。
 * 这个参数一度叫 `item` 而被当成 `min` 用，症状是"正文太短"这种查半天的校验失败——
 * 名字写明确，比留一个靠注释维护的坑便宜。
 */
export function stringList(
  opts: { min?: number; max?: number; itemMax?: number } = {},
): Codec<string[]> {
  const item = string({ max: opts.itemMax })
  return {
    kind: 'array',
    parse(value, path) {
      if (!Array.isArray(value)) return fail(path, `应为数组，实际是 ${typeName(value)}`)
      const out: string[] = []
      const failures: ParseFailure[] = []
      value.forEach((entry, index) => {
        const result = item.parse(entry, `${path}[${index}]`)
        if (result.ok) {
          if (result.value !== '') out.push(result.value)
        } else failures.push(...result.failures)
      })
      if (failures.length > 0) return { ok: false, failures }
      const checked = countCheck(out.length, path, opts.min, opts.max)
      return checked ?? ok(out)
    },
    describe() {
      return { type: 'array', items: item.describe() }
    },
  }
}

export function number(
  opts: { min?: number; max?: number; integer?: boolean } = {},
): Codec<number> {
  return {
    kind: 'number',
    parse(value, path) {
      const num =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
      if (!Number.isFinite(num)) return fail(path, `应为数字，实际是 ${typeName(value)}`)
      if (opts.integer && !Number.isInteger(num)) return fail(path, `应为整数，实际是 ${num}`)
      if (opts.min !== undefined && num < opts.min) return fail(path, `小于 ${opts.min}`)
      if (opts.max !== undefined && num > opts.max) return fail(path, `大于 ${opts.max}`)
      return ok(num)
    },
    describe() {
      const node: JsonSchemaNode = { type: opts.integer ? 'integer' : 'number' }
      if (opts.min !== undefined) node['minimum'] = opts.min
      if (opts.max !== undefined) node['maximum'] = opts.max
      return node
    },
  }
}

export function enumOf<T extends string>(values: readonly T[]): Codec<T> {
  return {
    kind: 'enum',
    parse(value, path) {
      if (typeof value !== 'string') return fail(path, `应为字符串，实际是 ${typeName(value)}`)
      const normalized = value.trim().toLowerCase()
      // 大小写与空格宽容，其它一律不：模型爱写 "Calm" 而不是 "calm"，这是事实；
      // 但"joy" 写成 "happy" 必须报错——那是它换了判据，不是换了写法
      const hit = values.find((v) => v === value.trim() || v.toLowerCase() === normalized)
      if (!hit) return fail(path, `只能是 ${values.join(' / ')} 之一，实际是「${value}」`)
      return ok(hit)
    },
    describe() {
      return { type: 'string', enum: [...values] }
    },
  }
}

export function array<T>(of: Codec<T>, opts: { min?: number; max?: number } = {}): Codec<T[]> {
  return {
    kind: 'array',
    parse(value, path) {
      if (!Array.isArray(value)) return fail(path, `应为数组，实际是 ${typeName(value)}`)
      const out: T[] = []
      const failures: ParseFailure[] = []
      value.forEach((entry, index) => {
        const result = of.parse(entry, `${path}[${index}]`)
        if (result.ok) out.push(result.value)
        else failures.push(...result.failures)
      })
      if (failures.length > 0) return { ok: false, failures }
      const checked = countCheck(out.length, path, opts.min, opts.max)
      return checked ?? ok(out)
    },
    describe() {
      const node: JsonSchemaNode = { type: 'array', items: of.describe() }
      if (opts.min !== undefined) node['minItems'] = opts.min
      if (opts.max !== undefined) node['maxItems'] = opts.max
      return node
    },
  }
}

type Shape = Record<string, Codec<unknown>>

export function object<T extends Record<string, unknown>>(shape: Shape): Codec<T> {
  return {
    kind: 'object',
    parse(value, path) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail(path, `应为对象，实际是 ${typeName(value)}`)
      }
      const record = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      const failures: ParseFailure[] = []
      for (const [key, codec] of Object.entries(shape)) {
        const result = codec.parse(record[key], path ? `${path}.${key}` : key)
        if (result.ok) out[key] = result.value
        else failures.push(...result.failures)
      }
      if (failures.length > 0) return { ok: false, failures }
      return ok(out as T)
    },
    describe() {
      const properties: JsonSchemaNode = {}
      const required: string[] = []
      for (const [key, codec] of Object.entries(shape)) {
        properties[key] = codec.describe()
        if (codec.kind !== 'optional') required.push(key)
      }
      return { type: 'object', properties, required, additionalProperties: false }
    },
  }
}

/** 缺省与 null 都算没给；给了就必须合法 */
export function optional<T>(inner: Codec<T>): Codec<T | undefined> {
  return {
    kind: 'optional',
    parse(value, path) {
      if (value === undefined || value === null || value === '') return ok(undefined)
      return inner.parse(value, path) as ParseResult<T | undefined>
    },
    describe() {
      return inner.describe()
    },
  }
}

/** 兜底默认值：模型漏了一个不影响叙事的字段时，别为了一个 mood 重跑整本 */
export function withDefault<T>(inner: Codec<T>, fallback: T): Codec<T> {
  return {
    kind: 'optional',
    parse(value, path) {
      if (value === undefined || value === null || value === '') return ok(fallback)
      const result = inner.parse(value, path)
      return result.ok ? result : ok(fallback)
    },
    describe() {
      return inner.describe()
    },
  }
}

/** 从可能是 ```json 围栏 / 带寒暄的文本里抠出第一个平衡的 JSON 值 */
export function extractJson(text: string): unknown {
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0)
  if (starts.length === 0) return null
  const start = Math.min(...starts)
  const open = text[start] as string
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export function parseWith<T>(codec: Codec<T>, text: string): ParseResult<T> {
  const json = extractJson(text)
  if (json === null) return fail('', '回答里找不到 JSON（可能被围栏截断，或它开始讲道理了）')
  return codec.parse(json, '')
}

export function formatFailures(failures: readonly ParseFailure[], limit = 8): string {
  const head = failures.slice(0, limit).map((f) => `- ${f.path || '(根)'}：${f.message}`)
  const rest = failures.length - head.length
  return rest > 0 ? [...head, `- （另有 ${rest} 条同类问题）`].join('\n') : head.join('\n')
}

/* ───────────────────────── 内部 ───────────────────────── */

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value }
}

function fail<T = never>(path: string, message: string): ParseResult<T> {
  return { ok: false, failures: [{ path, message }] }
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '缺失'
  if (Array.isArray(value)) return '数组'
  return typeof value
}

function countCheck(
  length: number,
  path: string,
  min?: number,
  max?: number,
): ParseResult<never> | null {
  if (min !== undefined && length < min) return fail(path || '$', `数量不足（${length} < ${min}）`)
  if (max !== undefined && length > max) return fail(path || '$', `数量过多（${length} > ${max}）`)
  return null
}
