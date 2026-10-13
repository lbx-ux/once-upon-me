import { describe, expect, it } from 'vitest'
import { canonicalDigest, canonicalJson, digest } from './digest.ts'

describe('canonicalJson', () => {
  it('键序不影响结果 —— 这是"语义指纹"与"临时字符串"的分界', () => {
    const a = { bone: '圆脸', eyes: '深棕', hair: '左上一撮翘' }
    const b = { hair: '左上一撮翘', eyes: '深棕', bone: '圆脸' }
    expect(canonicalDigest(a)).toBe(canonicalDigest(b))
  })

  it('数组保序：顺序是有意义的（选项左右 = 画面左右）', () => {
    expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']))
  })

  it('undefined 字段被丢弃，而不是变成 null', () => {
    expect(canonicalJson({ x: 1, y: undefined })).toBe('{"x":1}')
  })

  it('嵌套对象也排序', () => {
    expect(canonicalJson({ o: { b: 1, a: 2 } })).toBe('{"o":{"a":2,"b":1}}')
  })
})

describe('digest', () => {
  it('稳定 12 位十六进制', () => {
    const value = digest('小宇')
    expect(value).toMatch(/^[0-9a-f]{12}$/)
  })

  it('文本与字节走同一条路：同一个字符内容同一个指纹', () => {
    expect(digest('恐龙')).toBe(digest(new TextEncoder().encode('恐龙')))
  })

  it('改一个空格就换指纹（失效检测要的就是这个灵敏度）', () => {
    expect(digest('圆脸 大眼')).not.toBe(digest('圆脸  大眼'))
  })

  it('空输入不炸、且与任意非空不同', () => {
    expect(digest('')).toMatch(/^[0-9a-f]{12}$/)
    expect(digest('')).not.toBe(digest(' '))
  })
})
