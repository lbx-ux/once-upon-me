/**
 * digest.ts —— 内容指纹与规范化序列化
 *
 * ★ 这不是安全哈希，是**失效检测**用的：FNV-1a 64 位截断成 12 个十六进制字符。
 *   它回答的问题是"这份内容变没变"（角色卡改了一个锚点 → 指纹变 → 旧页被标记为
 *   出自另一版卡），不回答"有没有人造假"。要后者请换 crypto.subtle，
 *   但那是异步的、且在 node/edge/browser 三处行为不同 —— 本项目的纪律是
 *   **纯函数在 node 脚本里也能跑**，所以宁可留个诚实的弱哈希。
 *   碰撞概率：12 hex = 48 bit，在"一本书几十份资产"的量级上约等于零。
 */

// BigInt() 构造而不是 0x...n 字面量：tsconfig 的 target 是 ES2017，
// 字面量语法要 ES2020。运行时支持与否由 node/浏览器决定，不由 target 决定。
const FNV_OFFSET_BASIS = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')
const MASK_64 = BigInt('0xffffffffffffffff')

/** UTF-8 字节序列（TextEncoder 在 node 18+ / 浏览器 / edge 都有） */
const encoder = new TextEncoder()

function fnv1a64(bytes: Uint8Array): bigint {
  let hash = FNV_OFFSET_BASIS
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash
}

/** 12 位十六进制。字符串与字节流走同一条路，所以"文本改一个空格"与"图改一个像素"同样换名 */
export function digest(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  return fnv1a64(bytes).toString(16).padStart(12, '0').slice(-12)
}

/**
 * 规范化 JSON：对象键按字典序排，数组保序，undefined 字段丢弃。
 *
 * 存在的理由：角色卡的指纹必须是**语义**指纹。
 * `JSON.stringify(card)` 的键序取决于赋值顺序，于是"多读一次配置文件"
 * 这种毫无内容变化的操作会让所有资产换名，跨书复用当场失效。
 * 排序这一步不显眼，但它就是"可复用资产"与"一段临时字符串"的区别所在。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) out[key] = sortDeep(entry)
    }
    return out
  }
  return value
}

/** 规范化后再取指纹 —— 绝大多数调用其实要的是这个 */
export function canonicalDigest(value: unknown): string {
  return digest(canonicalJson(value))
}
