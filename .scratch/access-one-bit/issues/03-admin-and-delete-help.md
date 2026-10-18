# 03 · 管理页一格开关 + 删掉「帮助」与「申请」

Status: done

## 做什么

- 管理页：那一排四个开关 → 一列「权限 / 能否创作」；`admin/state.ts`、`admin/client.ts`
  (`setAllowed`)、`admin/users/[userId]/permissions/route.ts`（体只收 `{allowed}`）跟着改；
  建号那两句提示由"四个能力都关着"改成"默认有权限"。
- 删掉申请整条路（BFF 两条路由 + `lib/requests/**` + `RequestQueue` + `admin/server.ts` 的
  `readRequests` + `admin/page.tsx` 那一半 + `admin.css` 里的死样式）。
- 删掉「帮助」：`HelpDialog.tsx`、`AppShell` 里那一格与 `helpOpen`、`app-shell.css` 的 `.help__*`；
  `scripts/chk-shell-help-gate.mjs` 去掉量帮助弹窗的两项，留下悬停与"三处入口未登录都拦得住"。
- 文档：ADR-0010、ADR-0009 加指向、README §二/§五、演示账号那一节、GLOSSARY。

## 判据

- `/admin` 上只剩一列权限开关，而且老账号（补列之后）显示「有权限」。
- 未登录点三处入口，仍然弹「请先登录」（`chk-shell-help-gate.mjs` 第四项）。

## Comments

- 2026-10-18 完成。管理页那一眼是**真打开量出来的**（`scripts/chk-admin-access.mjs`，
  headless Chrome 直连 CDP，注入一张真登录拿到的 `xzj_session` cookie）：
  - 表头正好是 `["账号","昵称","注册","上次登录","作品","权限能否创作","账号"]`，
    **含"权限"的表头数 = 1**（回退成四个开关就会是 4）；
  - 演示账号那一行的「作品」格是 `4 本 · 3 张卡 · 1 个孩子`——用户要保留的那一列照旧；
  - 每一行的开关 `data-on="true"`、aria 标签是「… 的创作权限」，**禁用 = false**；
  - **页面报错 0 条**（收列最容易留的病是"读了已经不存在的字段"，这条专门照它）。
  - 截图写在该脚本的缺省路径上（`.out/access-verify/admin.png`，一列权限、两个橙色开关）——
    ★ `.out/` 不入库，所以它是**这一次会话的产物**；要再看见它，重跑上面那条命令即可。
- 那个脚本从 `chk-shell-help-gate.mjs` 改名成 `chk-shell-gate.mjs`（`git mv`）：
  它量的东西变了——不再是帮助弹窗的宽度与星号，而是**三处创作入口的登录闸**
  （真点击、判据是"弹窗在不在 + href 带没带 `?next=` + 有没有留在原页"）。
  文件头与 hydrate 判据那段说明跟着重写；旧名字会让下一个人以为它还在量帮助。
- 申请整条路删掉之后，老库里的 `permission_requests` 表**留着**（`SchemaUpgrades` 只加不删），
  这一条写进了 `db/schema.sql` 的文件头与 ADR-0010——不然下一个人会在库里撞见它。
