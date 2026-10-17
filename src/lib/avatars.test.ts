/**
 * avatars.test.ts —— 那六个默认头像
 *
 * ★ 这一组里最要紧的一条是**文件真的在**。判据不是"表里列了六个"——
 *   列了六个而 `public/avatars/` 里少一个的话，那一个 id 在界面上是一个
 *   **什么都不画的空格**（`<img>` 404 而 `alt=""`，正是这个仓库那条"不留碎图标"的
 *   兜底在做它的事），而它看起来与"这个人还没挑过头像"一模一样。
 *   所以这条测试读盘，不是读表。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AVATARS, avatarSrc, isKnownAvatar, NO_AVATAR_LABEL } from './avatars.ts'

const PUBLIC = join(process.cwd(), 'public')

describe('默认头像那一排', () => {
  it('六个，id 与名字都不重（重了的话一排里会有两张一样的卡）', () => {
    expect(AVATARS).toHaveLength(6)
    expect(new Set(AVATARS.map((item) => item.id)).size).toBe(6)
    expect(new Set(AVATARS.map((item) => item.name)).size).toBe(6)
  })

  /**
   * ★ 判据取"**只有真做了才会不一样**"的那一个：id 的形状必须与后端的
   *   `AccountRules.requireAvatarId`（`^[a-z0-9_-]{1,32}$`）对得上。
   *   对不上的话，前端挑得动、后端存不下——而界面上那句错误是
   *   "头像 id 不合法"，读起来像用户的问题。
   */
  it('每个 id 都过得了后端那个正则（`^[a-z0-9_-]{1,32}$`）', () => {
    for (const item of AVATARS) {
      expect(item.id, item.name).toMatch(/^[a-z0-9_-]{1,32}$/)
    }
  })

  it('★ 六个文件都在盘上，而且是一份 SVG（不是空文件、不是别的什么）', () => {
    for (const item of AVATARS) {
      const file = join(PUBLIC, 'avatars', `${item.id}.svg`)
      expect(existsSync(file), `${file} 不在`).toBe(true)
      const text = readFileSync(file, 'utf8')
      expect(text.startsWith('<svg'), `${file} 不是一份 SVG`).toBe(true)
      // ★ 认得出它是什么（读屏与 SEO 都读它）：`role="img"` + `aria-label`
      expect(text, `${file} 少了 aria-label`).toContain('aria-label=')
    }
  })

  /**
   * ★ 色值写死在 SVG 里（`<img>` 里读不到 `var(--x)`），所以"它是不是跟着配色走"
   *   这件事没有别的机器判据。这条断言把那份约定盯住：**至少那几个值必须来自
   *   `globals.css` 的令牌**，谁手改了一个不在令牌表里的颜色，这里会红。
   *   （不追求完整：令牌换值的那天这里也要跟着换，这是文件头写明的那一处人工同步。）
   */
  it('用的颜色都是 `globals.css` 里那几枚令牌的值', () => {
    /* ★ 2026-10-17：这一屏转冷（用户要蓝），所以 `--card-paper`(#f7efe3) 与
       `--accent`(#c2410c) 换成了 `--pf-paper`(#e8f0f6) 与 `--pf-accent`(#427294)。
       换的是**值**不是这条约定——它现在盯的是"这一屏那一组"的令牌，
       与 `profile-home.css` 消费的是同一组（都定义在 `globals.css` 的 `:root`）。 */
    const allowed = new Set(['#e8f0f6', '#f4f8f9', '#427294', '#17171d', '#6b6a74'])
    for (const item of AVATARS) {
      const text = readFileSync(join(PUBLIC, 'avatars', `${item.id}.svg`), 'utf8')
      for (const hex of text.match(/#[0-9a-f]{6}/g) ?? []) {
        expect(allowed.has(hex), `${item.id}.svg 里的 ${hex} 不在令牌表里`).toBe(true)
      }
    }
  })
})

describe('认不出来的 id', () => {
  it('★ 一律是 `null`，而不是"回落到某一个默认头像"', () => {
    // 回落成某一个的话，症状是"我以外的人看起来都变成了同一个头像"——而那种错没人会去查
    for (const bad of ['', 'fox', '../../etc/passwd', '云', 'YUN']) {
      expect(avatarSrc(bad), bad).toBeNull()
      expect(isKnownAvatar(bad), bad).toBe(false)
    }
  })

  it('空串与只有空白的都算"没挑过"', () => {
    expect(avatarSrc('   ')).toBeNull()
    expect(NO_AVATAR_LABEL).not.toBe('')
  })

  it('认得出来的给的是**站内绝对路径**，不拼域名、不拼 base', () => {
    // ★ 绝不写成 `new URL(id, base)`：本机在一个 fake-IP 代理后面，拼地址会拼到代理那儿
    for (const item of AVATARS) {
      expect(avatarSrc(item.id)).toBe(`/avatars/${item.id}.svg`)
      expect(isKnownAvatar(item.id)).toBe(true)
    }
  })
})
