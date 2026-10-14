/**
 * stores.test.ts —— `extensionOf`：资产文件名要能被浏览器直接认
 *
 * ★ 这一条是被实测抓出来的，不是推演出来的：
 *   百炼的语音接口回的 content-type 是 **`audio/mpeg`**，而它**不含 `mp3` 这三个字符**，
 *   于是音频资产落成了 `page-1-a1.bin`（2026-10-14，`.out/tts-int.mts` 第一次跑）。
 *   症状很轻——字节是对的、能播——但文件名在撒谎，而文件名是排障时唯一先看到的东西。
 *
 * 顺带锁住 `video/mpeg` 不许被叫成 `.mp3`：这就是"笼统写 includes('mpeg')"会踩的坑。
 */

import { describe, expect, it } from 'vitest'

import { extensionOf } from './stores.ts'

describe('extensionOf · 音频要认得出', () => {
  it('audio/mpeg → .mp3（实测那个 mime 就是它）', () => {
    expect(extensionOf('audio/mpeg')).toBe('.mp3')
    expect(extensionOf('audio/mp3')).toBe('.mp3')
    expect(extensionOf('audio/mpeg; charset=binary')).toBe('.mp3')
  })

  it('但 video/mpeg 不是 mp3', () => {
    expect(extensionOf('video/mpeg')).not.toBe('.mp3')
  })

  it('wav / m4a（克隆样本那两种格式）', () => {
    expect(extensionOf('audio/wav')).toBe('.wav')
    expect(extensionOf('audio/x-wav')).toBe('.wav')
    expect(extensionOf('audio/m4a')).toBe('.m4a')
    expect(extensionOf('audio/x-m4a')).toBe('.m4a')
  })
})

describe('extensionOf · 原有的几条没被改坏', () => {
  it('图像与 json 仍然对', () => {
    expect(extensionOf('image/png')).toBe('.png')
    expect(extensionOf('image/webp')).toBe('.webp')
    expect(extensionOf('image/jpeg')).toBe('.jpg')
    expect(extensionOf('application/json')).toBe('.json')
  })

  it('大小写不敏感；认不出来才回 .bin', () => {
    expect(extensionOf('IMAGE/PNG')).toBe('.png')
    expect(extensionOf('application/octet-stream')).toBe('.bin')
  })
})
