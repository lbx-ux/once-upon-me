# 04 —— Next 那一侧的 BFF 与会话

`Status:` **done**（2026-10-16；界面那三道闸是工单 07）

## 要做什么

把"接后端那条缝"缝上——上一轮刻意只留了 `src/lib/auth/client.ts` 一个文件，
这一轮它换实现，**签名不变**。

- `src/lib/auth/backend.ts`（新）：唯一跟 Java 说话的地方。`BACKEND_URL`
  （默认 `http://127.0.0.1:8080`）、超时、`X-Internal-Token`、把 Java 的
  `{code,message}` 原样翻译成上层的失败。
- `src/lib/auth/session.ts`（新，服务端）：用 `node:crypto` **本地验票**
  （零依赖，不引 jose）；`requireCapability(req, caps)`：
  没票 → 401 `not-signed-in`；能力不够 → 403 `no-permission` +「当前用户没有权限，请联系管理员」。
  ★ 权限**每次向后端要**（`GET /api/auth/me`），不从票里读——钱花在哪儿，闸门就设在哪儿。
- `src/app/api/auth/{send-code,verify-code,set-password,login-password,logout,me}/route.ts`（新）：
  浏览器只跟它们打交道；票写进 `httpOnly` + `SameSite=Lax` 的 cookie。
- `client.ts`：五个函数体换成打 BFF，**签名与返回类型不变**；
  新增 `logout()` / `fetchMe()` / `pickAvatar()`；删掉 `MOCK_LATENCY_MS` 与那一整套模拟规则。
- `AuthProvider`：`AuthUser` 加 `permissions` / `avatar`；挂载时 `fetchMe()`；
  `signOut()` 改成打 BFF。★ 上一轮那条"首屏会闪一下"的注释可以删了——
  身份现在在服务端 cookie 里，服务端第一次就渲染对了。
- `state.ts`：删掉在册表 / 底账 / `DEMO_REGISTERED_PHONE`（后端接管），
  留 `maskPhone` / `safeNext` / `parseUser`。

## 怎么算做完

- 新号走完"发码 → 核验 → 两次设密码"进得来；**登出 → 用密码登回**，昵称与首次登录时间还在。
- `123456` / `123456` 直接进，且**服务端日志里没有发短信记录**。
- 网络面板里 `/api/books` 的请求体**没有 `env` 字段**。
- 那个 60 秒倒计时与"正在发验证码/正在登录"的 pending 态仍然是真的
  （后端真在跑，不再是等一个假的 320ms）。

## Comments

- 2026-10-16 完成。**真跑了一遍**（Java + Next dev 都在跑，从 BFF 打进去）：

  | 步骤                                         | 结果                                                                                                                                                                               |
  | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 演示账号密码登录 → `Set-Cookie: xzj_session` | 200                                                                                                                                                                                |
  | `GET /api/auth/me`（带 cookie）              | 200，`user` + `permissions` + `configured` 三样都在                                                                                                                                |
  | 新号发码（本地是开发模式）                   | 200，`{"devMode":true,"hint":"开发模式：没有真正发送短信，验证码固定 123456"}`                                                                                                     |
  | 核验                                         | 200，`{"kind":"needs-password"}`（票进了 cookie，**响应里没有票**）                                                                                                                |
  | 设密码                                       | 200                                                                                                                                                                                |
  | 新号 `GET /me`                               | 200，**四个权限全 false**（"没有权限"那条路的起点）                                                                                                                                |
  | 未登录 `GET /me`                             | 401 `not-signed-in`                                                                                                                                                                |
  | 登出后再 `GET /me`                           | 401（★ 第一次量出来是 200，原因是 **curl 没带 `-c`**：jar 没被 `Set-Cookie` 更新，旧 cookie 又送了一遍。不是代码的问题，但值得写下来——"登出没生效"这个结论太容易被同一种用法误导） |

- ★★ **实测撞到的一个真问题，值得单独记**：`JwtService` 原来写的是 `signWith(key)`
  （不指定算法），jjwt 会**按密钥长度自己挑**——密钥 65 字节时它挑的是 **HS512**，
  而 Next 那一侧只认 HS256（`session.ts` 里那一行是显式写的）。症状是
  **"登录明明成功，下一个请求就 401"**，而两侧的代码各自看都没错。
  修法：**两侧都写死 HS256**（`signWith(key, Jwts.SIG.HS256)`），
  并在 Next 拒票时打一句 `[auth] 拒了一个 alg=… 的令牌`——下一次一眼就看出来。
  ★ 这正是那两个文件头里反复写的"两侧必须逐字一样的东西"的又一个实例：
  凡是"自动"的地方，就是两侧可能不一样的地方。
