# 14 —— 改密码

`Status:` **done**（2026-10-17）

## 要做什么

用户 2026-10-16 的原话：「增加一个改密码的功能」。最小可用形状：

- 后端 `PATCH /api/auth/password`：`{currentPassword, newPassword}` → 新票 + user。
- BFF `src/app/api/auth/change-password/route.ts`：转发，并把新票写回 cookie。
- 个人主页 `/account` 加一栏：现在的密码 / 新密码 / 再输一遍 + 一句说明。

★ **这个功能有一半不在"改"上，在"撤销"上。** 一个人改密码，
别处那些已经登着的会话必须失效——否则"改密码"在一半的场景里
（"有人知道我旧密码"）什么都没做。这一轮没有 token 黑名单，所以撤销只有一条路：
把"密码什么时候改的"记下来（`users.password_changed_at`），比它早签发的票一律作废。

三条判断：

1. **要现在的密码**。只要拿着会话就能改的话，一个被借走的 cookie 就等于账号本身。
2. **错 5 次就锁**（复用登录那把 `LoginAttemptGuard`）。否则这就是一把**不限速的密码验证器**。
3. **新密码不能与现在的一样**。"改"成一个相同的值看着像成功、实际什么都没变，
   却会把别处的会话全踢掉——一件纯有害的事。

## 怎么算做完

- `mvn test` 全绿，`ChangePasswordIntegrationTest` 覆盖六条（旧票作废 / 现在的密码不对 /
  太短 / 与现在相同 / 未登录 401 / 连错 5 次锁住）。
- 前端三条闸门 + `pnpm test` 全绿。
- 浏览器里真改一次，并且**别的设备真的被踢下线**（这一条是判据里最有判别力的那个）。

## Comments

- 2026-10-17 完成。`mvn test` **55 条全绿**，`pnpm test` **771 条全绿**，
  `format:check && lint && typecheck` 全过。

- ★ **两次实测踩坑，都写在这里，因为它们都不是"代码写错了"那一类。**

  **① 秒级精度的票 vs 微秒级的库（第一版实现，被测试逮住）。**
  第一版的判据是"票的 `iat` 早于 `password_changed_at` 就作废"，而 JWT 的 `iat`
  只有**秒**、MySQL/H2 的 `DATETIME` 有**微秒**：同一秒内签发的票，
  `iat` 会小于 `password_changed_at`，于是**刚改完密码的人自己下一个请求就被登出**。
  修法是换掉判据：票里放一个**密码代次** `pv`（就是 `password_changed_at` 的 epoch 秒，
  没改过是 0），服务端比"票里的代次 == 库里现在这一代"。
  比时间在精度不同的两个系统之间永远有一道缝，比代次没有。

  **② `PATCH` 打到一个还没重启的旧进程上 → 500，而且日志里是一屏栈（2026-10-17 实测）。**
  浏览器里点「改密码」报"程序出错，请过一段时间再试"、HTTP 500。真相只有一句
  "这个地址不接受 PATCH"——`GlobalExceptionHandler` 那条 `Exception` 兜底
  把 Spring 自己抛的 `HttpRequestMethodNotSupportedException` 一起吞了。
  顺手实测：`GET /api/nope` 也回 500。**500 是监控会报警的那一档**，
  把"打错了地址"混进去，真出事那天就没有信号了。三条各自认领状态码：
  405 `method-not-allowed`（带上"它认的是 PATCH, POST"）/ 404 `not-found` /
  415 `bad-content-type`。`ChangePasswordIntegrationTest` 里现在有一条守着这三条。

  **③ 加这一列之后，本地那个已经存在的 H2 文件库起不来了**：
  `Column "password_changed_at" not found`，一屏 MyBatis 的栈。
  `schema.sql` 全是 `CREATE TABLE IF NOT EXISTS`，它管得住"表没建过"、
  管不住"表建过了、后来又加了一列"。加了 `config/SchemaUpgrades`：
  一张**列出来的**补列清单，启动时先问库"这列在不在"，缺了才 ALTER（幂等）。
  ★ 它不是迁移框架，也不做成"跑一个目录里的 SQL 文件"——那立刻要面对版本表、
  顺序、回滚一整套，而这一轮的库一共四张表。

- ★ 浏览器这一遍验的是**三件事同时成立**（这是"撤销"那半的判据）：

  | 量法                                                          | 结果                                                              |
  | ------------------------------------------------------------- | ----------------------------------------------------------------- |
  | 改密码**之前**用 curl 另登一张票（模拟"别的设备"）            | `GET /api/auth/me` → 200                                          |
  | 在浏览器里改密码（`18635090513`，`xiaozhujue2026` → `…2027`） | `POST /api/auth/change-password` → 200，界面"改好了"              |
  | **别的设备那张旧票**                                          | `401 {"code":"not-signed-in","message":"密码改过了，请重新登录"}` |
  | 旧口令登录                                                    | `400 bad-password`「密码不对」                                    |
  | 新口令登录                                                    | `200`                                                             |
  | **改密码那一台自己**                                          | `GET /api/auth/me` → 200（不该把自己踢出去）                      |
  | 拿错口令再改一次                                              | `400 bad-password`「现在的密码不对」，界面显示同一句              |

  ★ 界面那一栏的字段 id 是 `#pw-current` / `#pw-new` / `#pw-confirm`，
  提交按钮 `disabled={!currentPassword || !newPassword}`——**这条 disabled 是探针的闸门**：
  `preview_fill` 只改 DOM 的 `value`，React state 不动，按钮仍是灰的；
  必须用原生 setter + `input` 事件才会真的填进去。填完按钮变蓝，才说明 state 到手了。

- 代价写进 README §五：**撤销只对"经过服务端的判断"生效**（`/me`、改昵称、换头像、
  管理接口，以及 BFF 在每个要花钱的接口前问的那一次 `/me`）。
  纯页面读取不在这条路上（Next 那一侧本地验票就放），所以撤销对钱和写操作是即时的，
  对"看一页书"不是。
