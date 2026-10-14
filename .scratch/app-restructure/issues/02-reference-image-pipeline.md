# 02 · 参考图通路：引擎加一条 `edits`，上传图做归一

Status: open
依赖：[01](01-model-selection.md)（结论已有）；被 [03](03-character-profile.md) 依赖
硬约束：这条通路的实现**必须留在 `src/lib/engine/providers/`**，组件里一行 fetch 都不许有
（`lib/engine/` 不得 import React，且"一个 node 脚本能跑完整本生成"是 #11 的证据本身）

## 一、实测事实（本单的全部依据）

| 事实     | 值                                                                                        |
| -------- | ----------------------------------------------------------------------------------------- |
| 路由     | `POST {root}/v1/images/edits`，body `{ model, image: <dataURL>, prompt }`                 |
| 现状模型 | `wan2.7-image`，**不需要换**                                                              |
| 耗时     | **15.0s**（一次，单张）                                                                   |
| 尺寸约束 | 参考图宽高 **240～8000 px**（服务端原文），否则 `IMAGE_INPUT_DIMENSIONS_INVALID`          |
| 通道约束 | **不接受带 alpha 的 PNG**，否则 `IMAGE_INPUT_ALPHA_UNSUPPORTED`                           |
| 归一后   | `sharp.flatten({background:'#fff'})` → 1440²，3 通道，2.36 MB → **200**，产物 2.27 MB PNG |
| 保真度   | 同角色（发型/脸型/年龄）成立；**衣服配色有偏差**（未量化，见 §三）                        |

★ `image` 是**单张**（string），不是数组。多图参考要换供应商（见 [spec §1.3](../spec.md)），
**本单不做**。

## 二、要做的事

### 2.1 归一化必须在**服务端**做，且是一条可测的纯函数

上传的是用户手机里的照片：HEIC/JPEG/PNG、带旋转 EXIF、可能 4000×3000、可能带 alpha、
可能 80 KB 也可能 12 MB。这些都得在**送进 provider 之前**变成一个已知形状。

- 落点：`src/lib/engine/image/normalize.ts`（新目录，纯函数 + `sharp`）
- 签名形状：`normalizeReference(bytes, {maxSide}) → {bytes, mime, width, height, flattened}`
- **必须报回**它做了什么（压平了 alpha？缩到了多少？），因为用户要能在界面上看到
  "我们处理了你的照片"而不是猜
- 边界：小于 240 的正方形要**放大**还是**拒绝**？→ 拒绝并给出人话文案
  （"这张照片太小了，至少要 240×240"）——静默放大会给出一张糊的插画，比报错更糟

**测试**：`normalize.ts` 是确定性逻辑，走既有 tdd 路线（[w2 工单 09]）。
输入 fixture 至少覆盖：1×1、240×240 边界、8000×8000 边界、带 alpha PNG、
带 EXIF 旋转的 JPEG、12 MB 大图。`sharp` 在 node 环境里可用（W1 已见过它解析 `.pnpm` 绝对路径）。

### 2.2 引擎的 provider 侧：`ImageProvider` 加一个能力位

现有适配器 `tokenrhythm-image.ts` 只走 generations。要加的是**同一家、第二条路由**，
所以不新建 adapter，加一个方法：

```ts
// providers/types.ts 的形状（示意，按实际类型走）
interface ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult>
  // 可选：支持参考图的 provider 才实现。不支持时由调用方给出人话错误
  edit?(req: ImageRequest & { reference: ImageReference }): Promise<ImageResult>
}
```

`IMAGE_SUPPORTS_REFERENCE=0` 这个环境变量**要翻成 1，或者干脆删掉**——它是 W1 那条
错误结论的化石。倾向**删掉**：能力由"provider 有没有 `edit`"表达，比一个可能忘记同步的
字符串开关更难骗。（若保留，理由是"同一家也可能只有部分模型支持"，那就在
[01](01-model-selection.md) 的探测脚本里量出这个开关该取什么值，而不是手填。）

### 2.3 失败要分得开

三条服务端错误码各自对应一句不同的用户话，**不许合并成"生成失败"**：

| 服务端                           | 界面                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ |
| `IMAGE_INPUT_DIMENSIONS_INVALID` | 照片太小/太大，并说明是**参考图**的问题不是在生成的问题                  |
| `IMAGE_INPUT_ALPHA_UNSUPPORTED`  | 这条在我们归一化之后**不该出现**——出现了就是 bug，报"内部错误"并附 trace |
| 超时                             | 15s 是实测的常态，超时阈值要明显高于它                                   |

★ 最后一条是这一单最容易糊弄的地方：**"我们归一化过了"这句话要能被证明**。
做法是归一化后把尺寸/通道数记进 `events.jsonl` 的一条 `debug` 事件里，
于是下次真出现 alpha 错误时，事件流里躺着那张图的形状。

## 三、验收

- [ ] `node scripts/engine-run.mts --mode=stub` 仍跑通；engine 目录 `grep -r "react"` 为空
- [ ] `normalize.ts` 六类 fixture 的测试全过，含两条边界（240、8000）
- [ ] 端到端：**插画**参考 → 200，产物落盘并看图核对（与 §一 那次一致）
- [ ] 端到端：**真实照片**参考 → 见 [spec §四 未决 1](../spec.md)，**需要用户提供的照片**；
      量不出来就在本单写"没量到"，不许用插画那次的结果代表照片那一次
- [ ] 界面侧：上传框只在 provider **真的**有 `edit` 时才渲染（没有消费方的输入框就是假装）
- [ ] 一次失败路径的实测：故意送 200×200 的图，看界面上出现的是"照片太小"
      而不是"生成失败"
- [ ] 四条闸门 + `pnpm build`

## Comments

（开工时在此追加）
