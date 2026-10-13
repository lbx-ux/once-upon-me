# 前端框架锁 Next.js 15 App Router，且锁在 15.5.27 不追新

赛道官方把「React + Next.js 14+」列为推荐首选，本项目要的是**全栈能力简化后端**：
Server Components 直接做首屏预渲染（首页三屏的静态 HTML 是爬虫与禁用 JS 用户的唯一来源），
Route Handler 当 AI 接入层（官方特别说明第 1 条：后端只作接入层，不重点考察）。
备选 Vue 3 + Nuxt 3、SvelteKit、Vite SPA 都能做，但前两者的生态与本仓库已有的
手写令牌体系无优势，第三个拿不到服务端。**版本锁 15.5.27 而不是追最新**：已交付三屏里
每一处「实测数字」都是在这一版上量的（首屏交接段那三个互相咬合的数、`useScrollDriver`
的帧率窗口、SSR 卡片计数），换大版本要重跑全部测量，而官方只要求 14+。

- Status: accepted
- Considered Options: Vue 3 + Nuxt 3（生态相当，但要重写已交付的东西）；Svelte 5 + SvelteKit（性能更好，团队与技能库不在这一档）；React + Vite（拿不到 SSR 与 Route Handler）
- Consequences: 技能库里 `ui-ux-pro-max` 的 Next.js 约定表标注适用于 **16.2**，与本项目的 15.5.27 有版本差，取用时要逐条对照，不要照搬

---

写这份 ADR 时查过的事实（2026-10-12）：

| 事实                                                                                         | 来源                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 官方推荐 React + Next.js 14+，理由「App Router / Server Components / API Routes / 流式渲染」 | 《官方规则与评分标准》§10.1（赛道详情页抓取）          |
| 后端只作 AI 接入层，不作重点考察                                                             | 同上 §10.3 第 1 条                                     |
| App Router + Server Components 默认、少写 `'use client'`                                     | `ui-ux-pro-max` `stacks/nextjs.csv`，核实于 2026-08-13 |
