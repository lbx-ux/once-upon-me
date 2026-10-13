# 01 · 共用数学 `lib/math.ts`

Status: done
Spec: ../spec.md

## What

`clamp` / `smoothstep` / `lerp` 三个纯函数，带测试。

## Why 现在建

第三屏要第三次写 `smoothstep`（`HeroOrbit.tsx` 一份、`useScrollDriver` 里隐式一份）。
三份手抄的同一个小函数，改一处忘两处是迟早的事。

## 边界

**只给新代码用。** 不迁移 `HeroOrbit` 与 `useScrollDriver`——
那是单独一个提交，行为必须一字不变（同 README 未做清单里那条纪律）。

## 验收

- `pnpm test` 绿
- `smoothstep(1, 1, 0.5)` 不返回 NaN（退化区间除零）

---

## Comments

**2026-10-12 完成。** 红→绿各一轮：先跑 `pnpm test` 看到 `Cannot find module './math'`，再写实现。

途中 `noNegZero` 是被 tilt 的测试**逼出来的**，不是一开始想到的：
`-1 * 0` 产出 `-0`，`(-0).toFixed(2)` 是字符串 `"-0.00"`，
于是 `rotateY(-0deg)` 与 `rotateY(0deg)` 数值等价、字符串不等价，
而这一屏的写入路径靠字符串去重（`setVar` 那一层）。测试报 `-0 !== +0` 时先以为是洁癖，
查下去才发现它会让去重失效。

`smoothstep` 的退化区间那条与 `HeroOrbit` 那份**行为不同**（那一份返回 NaN），
但它现有调用点从不传退化区间，所以不是修 bug，是共用函数不该留这个坑。已写在文件头。
