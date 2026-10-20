/**
 * photo-form.test.ts —— multipart 那几格里最容易搞反的几件事（工单 03 第二刀）
 *
 * 这个文件盯的是默认值，因为这一层唯一的风险就是默认值反了：
 *   `consent` 缺字段、写成 `'on'`、写成 `'1'` —— 只要有一种被当成同意，
 *   那一格就不是凭据了。而浏览器把复选框序列化成什么是个细节（原生表单是 `on`），
 *   所以这条必须由用例钉住，不能靠"我记得是 true"。
 */

import { describe, expect, it } from 'vitest'

import { anchorsFrom, parsePhotoForm } from './photo-form.ts'

function formOf(fields: Record<string, string>, file?: Blob): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  if (file) form.set('photo', file, 'probe.jpg')
  return form
}

describe('consent 只认字面量 true', () => {
  it('★ 缺字段 / on / 1 / 大小写不对，统统算没同意', async () => {
    for (const value of [undefined, 'on', '1', 'TRUE', 'yes', '']) {
      const fields: Record<string, string> = { name: '小宇' }
      if (value !== undefined) fields['consent'] = value
      const parsed = await parsePhotoForm(formOf(fields))
      expect(parsed.consent, `consent=${String(value)}`).toBe(false)
    }
  })

  it('写 true 才是同意', async () => {
    expect((await parsePhotoForm(formOf({ consent: 'true' }))).consent).toBe(true)
  })
})

describe('照片字节', () => {
  it('没有那一格 → 空数组（判据那边会说"还没有选照片"）', async () => {
    expect((await parsePhotoForm(formOf({}))).photo.length).toBe(0)
  })

  it('有那一格 → 读成字节，一个不多一个不少', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const parsed = await parsePhotoForm(formOf({}, new Blob([bytes], { type: 'image/jpeg' })))
    expect([...parsed.photo]).toEqual([1, 2, 3, 4, 5])
  })
})

describe('锚点那一段坏了也不让整条请求失败', () => {
  it('半截 JSON / 不是数组 / 全是空值 → 都回空表，而不是抛', () => {
    expect(anchorsFrom('{"slot":"bone"')).toEqual([])
    expect(anchorsFrom('"bone"')).toEqual([])
    // 两条都没有 value：收下去等于往锚点表里塞两条空描述，后面会一路带着走
    expect(anchorsFrom('[{"slot":"bone"},{"value":"圆脸"}]')).toEqual([{ slot: '', value: '圆脸' }])
  })

  it('正常的那些照收，空值丢掉', () => {
    expect(anchorsFrom('[{"slot":"bone","value":" 圆脸 "},{"slot":"eyes","value":""}]')).toEqual([
      { slot: 'bone', value: '圆脸' },
    ])
  })
})

/*
 * 这里原来有一组 `envFromForm` 的测试（"解析不出来就是空表"那两条）。
 *   2026-10-16 那个函数随 ADR-0008 一起退场了：这条路由上的照片是交给模型读的，
 *   而密钥现在由站长分配、只从服务端的 `process.env` 来，所以这张 multipart 表单里
 *   没有 `env` 这个字段了。留一句在这里，是因为下一个读这一段的人会问"那两条呢"。
 */
