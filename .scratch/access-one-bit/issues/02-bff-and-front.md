# 02 · BFF 与前端：`permissions` → `allowed`

Status: done

## 做什么

- `lib/auth/session.ts`：`MeView.user.allowed`；`requireCapability` 判 `me.user.allowed`
  （`caps` 仍然写"这条路由要什么"，理由与政策写在函数上）。
- `app/api/auth/me/route.ts`：回 `{ user, allowed, configured, speechModel }`。
- `lib/auth/client.ts` 的 `MeResult`、`lib/auth/state.ts` 的 `AuthUser` 一起改；
  删掉没有读者的 `missingForCreate`。
- 消费点：`AuthProvider`（context 的 `permissions` → `allowed`）、`SignInGate`（判词 + 那句
  已经变成假话的"也才知道哪些能力对你的账号开了"）、`CreateLanding`、`GenerationSetupDialog`、
  `VoiceProvider`、`lib/voices/state.ts` 的 `no-permission` 文案。

## 判据

- `pnpm typecheck` 之后仓库里不该再有一处把 `permissions` 当"这个人有什么"的读法。
- `voices/state.ts` 那三条 `narrationBlockOf` 的判据顺序不变（权限 → 站里 → 我的音色）。

## Comments

- 2026-10-18 完成。`pnpm test` → 76 个文件 / 956 条全过；`pnpm lint`、`pnpm typecheck` 全绿
  （typecheck 起初红在 `.next*` 里**上一次生成的**路由类型还指着已删的
  `/api/permission-requests`——删掉那几份生成物即恢复，没有改代码去迁就它）。
- `Permissions` / `NO_PERMISSIONS` / `canCreate` **留着**，因为它们现在的读者是 `configured`
  （站里配没配那一项密钥），四项仍然各自独立。文件头上写明了"别再拿它装人"。
- **端到端量到的**（隔离栈：8082 上的独立后端 + `dev-preview.mjs --dist=.next-access --port=3338`，
  判据都取只有真做才会不同的量）：
  - 未登录 `POST /api/optimize`（真花钱的那条路）→ **401 `not-signed-in`**；
  - 演示账号 `123456` / `123456` 真登录 → `GET /api/auth/me` 回 `allowed: true`；
  - 同一张 cookie 打 `/api/optimize` → **200，真跑了一次模型**（返回的是一句真的优化后的题词，
    不是桩）；
  - 站长在管理页把权限关掉（`PATCH /api/admin/users/<id>/permissions` 体 `{"allowed":false}`）→
    **同一张旧 cookie** 再打 `/api/optimize` → **403 `no-permission`**，
    那句话仍是「当前用户没有权限，请联系管理员」；开回来 → 200。
    ★ 这一条正是"下次点开始创作就生效"，不是"等他重新登录"。
  - 未登录点三处入口（创作 / 人物 / 声音）：`scripts/chk-shell-gate.mjs` 真 CDP 点击，
    三处都弹「请先登录」、都是 `<a>` 带 `?next=`、都**留在原页**（页面报错只有未登录
    `/api/auth/me` 的 401，那是预期）。
