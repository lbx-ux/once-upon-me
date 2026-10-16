# 01 —— 认证状态 + 接后端的缝

`Status:` **done**

## 要做什么

新建 `src/lib/auth/`，与 `src/lib/settings/` 同一层、同一条分工。

### `state.ts`（纯，可测）

- `type AuthUser = { userId, phone, nickname, createdAt }`
  - `userId` 本地模拟长这样：`local-13800138000`——**看得出是本地造的**。
  - `nickname` **空串是合法值**，意思是"还没起过"，不是"缺数据"。
- `AuthStorage` 是最小接口（只要 `getItem` / `setItem` / `removeItem`）。
  ★ **存储是参数，不是全局**：`vitest.config.mts` 跑 `environment: 'node'`，那里没有
  localStorage。默认参数写 `= browserStorage()` 而不是 `= window.localStorage`，
  所以服务端渲染时求值得到 `null`，不会抛。
- `maskPhone('13800138000')` → `'138****8000'`；**不是 11 位就原样返回**，
  不套一个假的星号形状（盖了 `*` 会让坏数据看起来"打码过了"）。
- `safeNext(value)` —— `?next=` 的白名单：必须 `/` 开头、第二个字符不能又是 `/`、
  不能带反斜杠。`//evil.com`、`/\evil.com`、`https://evil.com` 全给 `null`。
- `parseUser(raw)` 逐字段验，坏数据返回 `null`**不抛**。
- `loadUser` / `saveUser` / `clearUser` / `loadRegistered` / `addRegistered` / `isRegistered`
- **底账**（`AuthProfile` + `loadProfiles` / `loadProfile` / `saveProfile`，
  键 `xiaozhujue.auth.profiles`）：`首次登录时间` 与 `昵称`。
  ★ 它**单独一张表**、登出**不清**——理由与那张在册表同源：登出不该让一个号码
  忘掉自己设过密码，也不该让它忘掉自己叫什么、第一次是什么时候来的。
  这张表是**在浏览器里踩到之后补的**（症状与根因写在 02 号工单末尾）。
- `DEMO_REGISTERED_PHONE = '13800138000'`（参考稿那个演示已有账号）。
  ★ **它不写进存储**，是 `isRegistered()` 现算的一部分：写进去就等于第一次访问
  就往用户的盘上留一条他没做过的记录，而且以后换演示账号还得写迁移。

### `client.ts` —— ★ **「接后端」那条缝就是这一个文件**

五个函数，一个不多一个不少：`sendCode` / `verifyCode` / `setPassword` /
`loginWithPassword` / `updateNickname`。

模拟规则（要自洽，不能每个号码每次都被当成新用户）：

1. 验证码：任意 6 位数字通过。
2. 号码**在册**（设过密码）→ 验证码通过后直接登录；不在册 → 进「设置密码」。
3. 设密码成功 → 号码进本机那张"在册表"。
4. 密码登录：在册 → 密码 ≥ 8 位就通过；不在册 → 「这个号码还没设过密码，先用验证码登录」。
   这是**一句真话**，也正是真后端会说的话。
5. ★ **本地一个密码都不存**。表里那件事实是"这个号码在册"，不是一个凭据。
   即使只是模拟，把口令明写进 localStorage 也是坏示范——这个仓库的读者会照抄。
6. `MOCK_LATENCY_MS = 320`：每个函数都先等一会儿。真接口**一定**是异步的，
   而一个立刻 resolve 的模拟会让"正在发验证码""正在登录"那些 pending 态**一次都走不到**。
   这是这一层唯一凭空写下的东西，接后端时连同它一起删掉。

`verifiedPhone` 是**模块级、不落盘**的一个变量：它兑现"`setPassword` 只在已通过验证码的
会话里可调"。没有它，打开控制台就能给任意号码设密码。

`buildUser()` 里的 `createdAt` 优先沿用本机已记着的那一份：不然同一个人重新登录
会把"首次登录时间"刷成现在——一个写着"首次"的字段每次登录都变，是坏的。

### `AuthProvider.tsx`

照 `SettingsProvider` 的样子，挂在 `src/app/layout.tsx`（不在页面里）。
对外 `{ user, ready, signIn, signOut, rename }`。

★ **首屏一律按未登录渲染**（`user = null` / `ready = false`），挂载后再 `loadUser()` 读回。
直接拿 localStorage 当初始值的话，服务端出「已登录」、客户端变「未登录」，
会闪一下并且 hydration 不一致。

## 验收

- `pnpm test` 里 `src/lib/auth/state.test.ts` 全绿（17 条 / 6 组）。
- `src/lib/auth/client.test.ts` 全绿（23 条 / 9 组）。
- `pnpm typecheck` 过（`tsconfig.engine.json` 那一份也要过——这一层不 import React）。

## Comments

### `state.test.ts`（17 条 / 6 组）

- 值钱的在两边：**坏数据不许炸**（localStorage 是用户能手改的地方）与
  **`?next=` 不许把人送到站外**（登录页最经典的那个洞）。中间几组是普通 round-trip。
- 存储双替身是 `fakeStorage()`（一个 `Map`），它就是这个测试文件的全部依赖——
  这一层能在 `environment: 'node'` 下真跑，证明它确实没碰浏览器全局。
- 有一条测试是**钉住"不写演示账号"**的：断言 `loadRegistered()` 是空数组、
  且 `Object.keys(storage.dump())` 是空的。这条断言没有功能价值，它的价值是
  下次有人想"顺手把演示账号写进去"时会红。

### `client.test.ts`（23 条 / 9 组）——★ 这一轮补上的

`client.ts` 是「接后端」那条缝，它的规则此前**一条都没被验过**。补上之后，
两个当初最难用眼睛确认的规则现在是钉死的：

1. **`setPassword` 绕不过去**，三种绕法各一条：
   - 从没验过就直接调 → 拒（这就是打开控制台那个人干的事）
   - 验的是 A 号、却给 B 号设密码 → 拒
   - 验完设成功之后再调一次 → 拒（用完即焚）
     三条都**连"号码没进册"一起断言**，因为只说"返回了错误"是不够的。
2. **验证码没过时，会话没被武装**：先送一个坏验证码，再调 `setPassword`，必须被拒，
   且存储仍然是空的。这一条挡的是"失败也顺手把会话开开"。
3. **口令一个都不落盘**：设完密码后在整个存储里搜那串口令（连 `hunter2` 这段子串一起搜），
   并断言存储里只有一件事实——`{"xiaozhujue.auth.registered": ["139..."]}`。
4. **`createdAt` 不被刷成现在**：预置一个 2020 年的首次登录时间，重新登录后它还是 2020 年；
   换一个号码进来则拿到新的时间、且昵称不跟着串过去。
5. **"还没设过密码"排在"密码至少 8 位"前面**：对一个不在册的号码 + 一个短密码，
   结论必须是前者——否则就是在让人去改一个不存在的密码。

★ 每个用例都 `vi.resetModules()` 再重新 import：`verifiedPhone` 是**模块级的会话状态**
（它故意的），不重置的话用例之间会串味，第二个用例会在第一个的会话里通过。
这条本身也顺带成了那个设计的一个回归护栏。

★ **没有 mock 掉 `MOCK_LATENCY_MS`**：那 320ms 正是"界面上那些 pending 态真的会出现"
的证据，抹掉它等于把这个文件变成另一个东西的测试。代价是这一个文件要跑 ~11 秒。

### 写测试时自己踩的两个坑（记下来省得下次再踩）

- `fakeStorage().dump()` 的**值本身是一段 JSON 字符串**（那正是 localStorage 的形状）。
  我第一版写 `JSON.parse(JSON.stringify(dump()))`，比的是 `"[\"139...\"]"` 这个字符串，
  于是断言失败——**测试写错了，不是代码写错了**。现在逐键再 parse 一次。
- `loadClient()` 每次都 `resetModules()`，所以 `verifyCode` 与 `setPassword`
  必须来自**同一次 import**：分两次拿就会在另一个模块实例上验证，然后被正确地拒掉。
