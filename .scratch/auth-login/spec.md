# auth-login —— 登录（只做前端）

`Status:` **done**（2026-10-16 收尾；四条工单见 `issues/`）

## 要做什么

给这个站加上「谁在用」这件事：

1. `/login` —— 手机号 + 验证码登录；新号码先设密码（两次输入要一致）；
   之后验证码与密码两条路都能进。
2. 侧栏底部那一格（原来空着）—— 未登录是「请登录」，登录后是「个人主页」。
3. `/account` —— 个人主页：头像占位 + 昵称（可改）+ 打码手机号 + 首次登录时间 +
   「这台设备上做过的东西」数 + 退出登录。

**这一轮只做前端**。真接口等后端做好再接——所以设计的重点有一半是
**把「接后端」这条缝留在唯一一个文件里**（`src/lib/auth/client.ts`）。

## 参考稿

`E:\match\login`（用户提供，双击 `index.html` 可看）。用户 2026-10-16 的原话是
**「和我提供给你的登录界面保持一样吧，你自己修改的不好看，背景就用提供的那个」**。
所以版式是**照搬**，不是重新设计——右栏是平涂 `--paper`，
**不铺工作台的 `StudioBackdrop`**。

## 影响到的文件

| 文件                                                          | 干什么                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/lib/auth/state.ts`                                       | 形状 + localStorage + 三个纯函数（打码 / next 白名单 / 校验）             |
| `src/lib/auth/state.test.ts`                                  | 上面那层的测试（存储是**传进去的**，所以 node 里能真测）                  |
| `src/lib/auth/client.ts`                                      | ★ **「接后端」那条缝就是这一个文件**                                      |
| `src/lib/auth/client.test.ts`                                 | 上面那条缝的契约（23 条：绕不过去的 `setPassword`、口令不落盘、底账留住） |
| `src/components/auth/AuthProvider.tsx`                        | `{ user, ready, signIn, signOut, rename }`，挂在根 layout                 |
| `src/components/auth/LoginPage.tsx` + `login.css`             | `/login` 那一屏                                                           |
| `src/app/login/page.tsx`                                      | 路由（**不在 `(studio)` 组里**：全屏，没有侧栏）                          |
| `src/components/account/ProfileHome.tsx` + `profile-home.css` | `/account` 那一屏                                                         |
| `src/app/(studio)/account/page.tsx`                           | 路由（**在 `(studio)` 组里**：工作台的一屏，侧栏留着）                    |
| `src/components/shell/AppShell.tsx` + `app-shell.css`         | 侧栏底部那一格                                                            |
| `src/app/layout.tsx`                                          | 把 `AuthProvider` 包在 `SettingsProvider` 外面                            |
| `src/app/globals.css`                                         | `@import` 两张新样式                                                      |
| `scripts/make-webp.py`                                        | 加第七档预设 `login-art`                                                  |
| `public/art/picnic-loop.{mp4,webp}`                           | 右栏那段水彩 + 它的静止替身                                               |
| `README.md`                                                   | `public/art/` 那一行                                                      |

## 素材（实测数）

| 文件                          | 字节      | 规格                                                         |
| ----------------------------- | --------- | ------------------------------------------------------------ |
| `public/art/picnic-loop.mp4`  | 1,944,714 | 768×768 / 10.125s / h264 1,396,580 bps + **aac 131,145 bps** |
| `public/art/picnic-loop.webp` | 84,086    | 960×960 / q=78，源自 824,219 B 的 `cover.jpg`（9.8×）        |

★ 那个 mp4 是**本仓库最重的一个文件**（比 `public/art/` 那 12 张封面加起来还大），
而它带着一条 **138 kbps 的 aac 音轨**——`<video muted aria-hidden>` 上，那是纯重量。
去音轨 + 重编码是**下一张单子**，不在这一轮悄悄改画质。

## 这一轮不做

- **不做门禁**：未登录照样能创作、看书。「哪些页面要挡」是个产品决定，没有被要求就不顺手定。
- **不做头像上传 / 改手机号 / 找回密码**：都要后端。
- **不 re-encode 那段视频**（见上），也不给它加 `backdrop-filter` 或视差（README §五 那两条账）。
- **不给首页加登录入口**：要求说的是侧栏那一格。
