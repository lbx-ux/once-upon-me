'use client'

/**
 * LoginPage —— `/login` 那一屏
 *
 * 流程照 `E:\match\login` 那份稿子：手机号 → 验证码/密码二选一 → 新用户先设密码 →
 * 完成。**一处刻意与稿子不同**：稿子最后有一个「登录成功」的中间态，要人再点一下
 * 「进入创作 →」；这里登录成功即 `router.replace` 走人。
 * 理由：真的登录页不该让用户替你把跳转点一下。那个中间态原本是给**静态稿**用的
 * ——双击 `index.html` 的人需要看到"成"了，而真页面不需要，他下一眼就在 `/home`。
 * 想去哪儿由 `next` 参数决定（侧栏点「请登录」时带上当前路径），取不到就回 `/home`。
 *
 * ★ 三个状态判断，都是这一屏独有的：
 *
 * 1. **`pending` 不是装饰**。`lib/auth/client.ts` 每个函数都会等一会儿
 *    （`MOCK_LATENCY_MS`，理由写在那儿），所以"正在发验证码""正在登录"是**真的**会发生的
 *    一段时间。这期间对应的那颗按钮必须 `disabled`：一个能连点两次的"登录"，
 *    在真接口那边就是两条请求。
 * 2. **错误只有一处来源**。所有文案都由 `client.ts` 给（`result.message`），
 *    这一层不自己编——接后端那天，服务端说什么就显示什么，
 *    而客户端自己写的那几句（"请输入 6 位验证码"）会跟着一起去掉。
 * 3. **「两次输入的密码不一致」是边输边报的**，不等提交。稿子就是这么做的，
 *    而这一条对：等到提交才说，人已经忘了自己第一次输的是什么。
 */

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useAuth } from '@/components/auth/AuthProvider.tsx'
import {
  loginWithPassword,
  sendCode,
  setPassword as setPasswordRequest,
  verifyCode,
  PASSWORD_MIN,
} from '@/lib/auth/client.ts'
import { maskPhone, safeNext, type AuthUser } from '@/lib/auth/state.ts'

/** 一个已验证会话只能设一次密码，所以这一屏只有两步 */
type Step = 'login' | 'set-password'
type Mode = 'code' | 'password'

/**
 * ★ 登录名有两种，判据与后端**逐字一样**（`AccountRules`）：
 * 11 位、1 开头的是手机号（能收短信），其它 6–11 位数字是**短账号**（只能密码登录）。
 * 演示账号 `123456` 就是后一种。★ 这一层判一遍只是为了让界面说得早一点
 * （比如那颗"获取验证码"该不该亮），**真正的规则在服务端**——两边不一致时，
 * 以服务端那句错为准。
 */
const ACCOUNT_PATTERN = /^\d{6,11}$/
const PHONE_PATTERN = /^1\d{10}$/
const CODE_PATTERN = /^\d{6}$/
/** 与后端同一条口径（`app.sms.same-phone-seconds`）；它只是体验，不是防线 */
const RESEND_SECONDS = 60
/* ★ 2026-10-17：`DEMO_ACCOUNT` 那个常量**删掉了**，连同页脚下面那一行
 *   「演示账号 123456 / 123456」的印刷（用户：「演示账号就不要明着写出来了」）。
 *   删常量而不是留着不用：一个没人读的常量下一次会被下一个人当成"还没接线的东西"
 *   再接回去。账号本身**在库里、在服务端没动**（`DemoAccount`，口令就是用户名），
 *   这条删的只是"印在登录页上"这一件事。
 *   ★ 代价要写明白：**评委从这一页再也拿不到进门的口令了**——
 *     它现在只写在交付说明与 `docs/known-tradeoffs.md` 里（连同"怎么停掉它"）。
 *     如果哪天要放回界面上，放回这里是最省事的位置，但那时也该想清楚
 *     "一个口令公开的账号挂在公网登录页上"这件事本身。 */

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.7 5.7A10.7 10.7 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a20.3 20.3 0 0 1-3.4 4M6.5 6.9A19.6 19.6 0 0 0 2 12s3.8 6.5 10 6.5c1.8 0 3.4-.5 4.8-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

/** 三处密码框共用的一颗眼睛。★ 抽出来只因为三份逐字一样的 SVG 是三次抄写 */
function EyeButton({
  shown,
  onToggle,
  label,
}: {
  shown: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      className="login__eye"
      type="button"
      aria-pressed={shown}
      aria-label={shown ? `隐藏${label}` : `显示${label}`}
      onClick={onToggle}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  )
}

export default function LoginPage({ next }: { next?: string | undefined }) {
  const router = useRouter()
  const { signIn } = useAuth()

  const [step, setStep] = useState<Step>('login')
  const [mode, setMode] = useState<Mode>('code')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [hasSentCode, setHasSentCode] = useState(false)
  /**
   * 开发模式那句"没有真正发送"。★ 它必须显示出来：本地那一档不发真短信，
   * 而一个悄悄不发的通道会让人在生产上也以为它在发（后端就是按这个口径回的）。
   */
  const [codeHint, setCodeHint] = useState('')

  const [phoneError, setPhoneError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [loginPasswordError, setLoginPasswordError] = useState('')
  const [newPasswordError, setNewPasswordError] = useState('')
  const [confirmPasswordError, setConfirmPasswordError] = useState('')

  /** 有请求在路上。★ 两个分开，因为它们各自 disable 的是不同的按钮 */
  const [sendingCode, setSendingCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  /**
   * 落点。★ 只在挂载那一刻算一次（`useState` 的初始化器）：
   *   `?next=` 是"你从哪儿被送过来的"，它不该在用户停留期间跟着变。
   *   `safeNext` 会挡掉 `//evil.com` 那类协议相对的写法——理由写在它旁边。
   */
  const [landing] = useState(() => safeNext(next) ?? '/home')

  // 60 秒倒计时。★ 用 `setTimeout` 逐秒递减而不是 `setInterval`：
  //   它天然与"这一次倒计时"绑定，卸载即清，不会留下一个还在跑的 interval
  useEffect(() => {
    if (countdown === 0) return
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const validatePhone = (value = phone): boolean => {
    if (!ACCOUNT_PATTERN.test(value)) {
      setPhoneError('请输入 11 位手机号，或 6 位以上的账号')
      return false
    }
    setPhoneError('')
    return true
  }

  /**
   * 这个登录名能不能收短信。
   * ★ 短账号（比如演示账号 `123456`）收不到——这是**结构上**的：
   * 后端判据是"它是不是一个手机号"。所以那颗按钮要早一点把这件事说清，
   * 而不是让人点下去、等一条永远不来的短信。
   */
  const canReceiveSms = PHONE_PATTERN.test(phone)

  const switchMode = (nextMode: Mode): void => {
    setMode(nextMode)
    setCodeError('')
    setLoginPasswordError('')
  }

  const onSendCode = async (): Promise<void> => {
    if (!validatePhone() || sendingCode) return
    if (!canReceiveSms) {
      setPhoneError('这个账号不是手机号，收不到短信——请切到「密码登录」')
      return
    }
    setSendingCode(true)
    const result = await sendCode(phone)
    setSendingCode(false)
    if (!result.ok) {
      setPhoneError(result.message)
      return
    }
    setHasSentCode(true)
    setCountdown(RESEND_SECONDS)
    setCodeHint(result.hint ?? '')
  }

  /** 两次输入一致吗。★ 边输边算，「确认」那一栏还空着的时候不报错 */
  const checkPasswordsMatch = (
    nextNewPassword = newPassword,
    nextConfirmPassword = confirmPassword,
  ): boolean => {
    if (!nextConfirmPassword) {
      setConfirmPasswordError('')
      return true
    }
    if (nextConfirmPassword !== nextNewPassword) {
      setConfirmPasswordError('两次输入的密码不一致')
      return false
    }
    setConfirmPasswordError('')
    return true
  }

  /** 登录成功：写进 Provider（它会落盘），然后走人 */
  const finish = (user: AuthUser): void => {
    signIn(user)
    // ★ 不调 `router.refresh()`：工作台此刻没有任何服务端组件读登录态
    //   （`/account` 读的是作品数，身份在客户端）。等后端落地、身份变成
    //   服务端 session 的那一天，这一行才需要补上。
    router.replace(landing)
  }

  const onSubmitLogin = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!validatePhone() || submitting) return

    setSubmitting(true)
    if (mode === 'password') {
      // ★ 这里**不判密码长度**：长度是"自己设密码"那一步的规则，而登录只比对哈希。
      //   判在这里的话，演示账号那个 6 位的口令会当场被自己人挡在门外
      const result = await loginWithPassword(phone, loginPassword)
      setSubmitting(false)
      if (!result.ok) {
        setLoginPasswordError(result.message)
        return
      }
      finish(result.user)
      return
    }

    if (!CODE_PATTERN.test(code)) {
      setSubmitting(false)
      setCodeError('请输入 6 位验证码')
      return
    }
    const verdict = await verifyCode(phone, code)
    setSubmitting(false)
    if (!verdict.ok) {
      setCodeError(verdict.message)
      return
    }
    if (verdict.kind === 'needs-password') {
      setStep('set-password')
      return
    }
    finish(verdict.user)
  }

  const onSubmitPassword = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (newPassword.length < PASSWORD_MIN) {
      setNewPasswordError(`密码至少 ${PASSWORD_MIN} 位`)
      return
    }
    setNewPasswordError('')
    if (!checkPasswordsMatch()) return

    setSubmitting(true)
    // ★ 只把密码递过去：手机号在那张票里（cookie），这一层拿不到也不需要
    const result = await setPasswordRequest(newPassword)
    setSubmitting(false)
    if (!result.ok) {
      setNewPasswordError(result.message)
      return
    }
    finish(result.user)
  }

  /** 「换个号码」：回第一步，并把上一个号码的痕迹清掉（验证码、密码、倒计时、那句开发模式提示） */
  const changePhone = (): void => {
    setStep('login')
    setPhone('')
    setCode('')
    setLoginPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setHasSentCode(false)
    setCountdown(0)
    setCodeHint('')
    setPhoneError('')
    setCodeError('')
    setLoginPasswordError('')
    setNewPasswordError('')
    setConfirmPasswordError('')
  }

  return (
    <main className="login">
      <section className="login__pane">
        <header className="login__brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login__mark" src="/brand/mark.webp" alt="" width={44} height={44} />
          <span className="login__wordmark">
            小主角 <span className="login__sep">·</span>{' '}
            <span className="login__latin">Once Upon Me</span>
          </span>
        </header>

        {step === 'login' ? (
          <section className="login__step" aria-labelledby="login-title">
            <div className="login__head">
              <svg
                className="login__doodle login__doodle--spark"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" />
              </svg>
              <svg
                className="login__doodle login__doodle--leaf"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M20 4C10.5 4 4 10.5 4 20c9.5 0 16-6.5 16-16Z" />
                <path d="M4 20C9 15 14 10 20 4" />
              </svg>
              <h1 id="login-title" className="login__title">
                欢迎回来
              </h1>
              <p className="login__lede">
                {mode === 'code'
                  ? '验证手机号，继续你的创作。首次登录会先设置密码。'
                  : '用已设置的密码登录，继续新的创作。'}
              </p>
            </div>

            <form
              className="login__form"
              noValidate
              aria-busy={submitting}
              onSubmit={onSubmitLogin}
            >
              <label className="login__field" htmlFor="phone">
                {/* ★ 「手机号 / 账号」而不是「手机号」：这一栏现在也收短账号
                    （演示账号 `123456` 就是），写着"手机号"会让人以为它不认 */}
                <span className="login__label">手机号 / 账号</span>
                <span className="login__box">
                  {/* ★ `+86` 只在它看起来是手机号时出现。
                      原来它是常驻的，而"一个 +86 前缀挂在 `123456` 前面"是明确错的 */}
                  {canReceiveSms || phone === '' ? (
                    <span className="login__prefix" aria-hidden="true">
                      +86
                    </span>
                  ) : null}
                  <input
                    id="phone"
                    className="login__input"
                    type="tel"
                    name="phone"
                    /* ★ 不放占位号码（用户 2026-10-16 要求）。
                       原来这里是 `13800138000`——那是演示账号，把它当占位符
                       会让人以为"这就是我的号"或者"系统已经填好了"。
                       演示账号现在写在下面的页脚里，一句说明而不是一个假输入 */
                    autoComplete="tel-national"
                    inputMode="numeric"
                    maxLength={11}
                    aria-invalid={Boolean(phoneError)}
                    aria-describedby={phoneError ? 'phone-error' : undefined}
                    value={phone}
                    onChange={(event) => {
                      const nextPhone = event.target.value.replace(/\D/g, '').slice(0, 11)
                      setPhone(nextPhone)
                      // 输满 11 位就当场验一次；没输满不报错（正在输的时候报错是噪音）
                      if (nextPhone.length === 11) validatePhone(nextPhone)
                      else setPhoneError('')
                    }}
                  />
                </span>
              </label>
              {phoneError ? (
                <p id="phone-error" className="login__error" aria-live="polite">
                  {phoneError}
                </p>
              ) : null}

              <div className="login__modes" role="group" aria-label="登录方式">
                <button
                  className={`login__mode${mode === 'code' ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={mode === 'code'}
                  onClick={() => switchMode('code')}
                >
                  验证码登录
                </button>
                <button
                  className={`login__mode${mode === 'password' ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={mode === 'password'}
                  onClick={() => switchMode('password')}
                >
                  密码登录
                </button>
              </div>

              {mode === 'code' ? (
                <div className="login__panel">
                  <label className="login__field" htmlFor="code">
                    <span className="login__label">验证码</span>
                    <span className="login__box">
                      <input
                        id="code"
                        className="login__input"
                        type="text"
                        name="code"
                        placeholder="6 位验证码"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        aria-invalid={Boolean(codeError)}
                        aria-describedby={codeError ? 'code-error' : undefined}
                        value={code}
                        onChange={(event) => {
                          setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                          setCodeError('')
                        }}
                      />
                      <button
                        className="login__send"
                        type="button"
                        /* ★ 短账号时直接禁用：它收不到短信（后端那条判据是结构性的），
                           让人点下去、等一条永远不来的短信是最坏的一种"能用" */
                        disabled={countdown > 0 || sendingCode || !canReceiveSms}
                        onClick={() => void onSendCode()}
                      >
                        {countdown > 0
                          ? `${countdown}s`
                          : sendingCode
                            ? '发送中'
                            : hasSentCode
                              ? '重新获取'
                              : '获取验证码'}
                      </button>
                    </span>
                  </label>
                  {codeError ? (
                    <p id="code-error" className="login__error" aria-live="polite">
                      {codeError}
                    </p>
                  ) : null}
                  {/* ★ 开发模式那句（后端回的 `hint`）原样显示：
                      "没有真正发送"这件事必须说出来，否则本地测试时
                      人会一直等一条不会来的短信 */}
                  {codeHint ? (
                    <p className="login__error login__error--hint" role="status">
                      {codeHint}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="login__panel">
                  <label className="login__field" htmlFor="login-password">
                    <span className="login__label">登录密码</span>
                    <span className="login__box">
                      <input
                        id="login-password"
                        className="login__input"
                        type={showLoginPassword ? 'text' : 'password'}
                        name="login-password"
                        placeholder={`至少 ${PASSWORD_MIN} 位`}
                        autoComplete="current-password"
                        aria-invalid={Boolean(loginPasswordError)}
                        aria-describedby={loginPasswordError ? 'login-password-error' : undefined}
                        value={loginPassword}
                        onChange={(event) => {
                          setLoginPassword(event.target.value)
                          setLoginPasswordError('')
                        }}
                      />
                      <EyeButton
                        shown={showLoginPassword}
                        onToggle={() => setShowLoginPassword((value) => !value)}
                        label="密码"
                      />
                    </span>
                  </label>
                  {loginPasswordError ? (
                    <p id="login-password-error" className="login__error" aria-live="polite">
                      {loginPasswordError}
                    </p>
                  ) : null}
                </div>
              )}

              <button className="login__submit" type="submit" disabled={submitting}>
                {submitting ? '正在登录' : mode === 'code' ? '验证并继续' : '登录'}
              </button>
            </form>
          </section>
        ) : null}

        {step === 'set-password' ? (
          <section className="login__step" aria-labelledby="set-password-title">
            <div className="login__head">
              <svg
                className="login__doodle login__doodle--spark"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5" />
              </svg>
              <h1 id="set-password-title" className="login__title">
                设置密码
              </h1>
              <p className="login__lede">
                手机号已验证。两次输入一致后，登录就完成了——以后也可以直接用密码登录。
              </p>
            </div>

            <form
              className="login__form"
              noValidate
              aria-busy={submitting}
              onSubmit={onSubmitPassword}
            >
              <div className="login__chip-row">
                <span className="login__chip">{maskPhone(phone)}</span>
                <button className="login__again" type="button" onClick={changePhone}>
                  换个号码
                </button>
              </div>

              <label className="login__field" htmlFor="new-password">
                <span className="login__label">新密码</span>
                <span className="login__box">
                  <input
                    id="new-password"
                    className="login__input"
                    type={showNewPassword ? 'text' : 'password'}
                    name="new-password"
                    placeholder={`至少 ${PASSWORD_MIN} 位`}
                    autoComplete="new-password"
                    aria-invalid={Boolean(newPasswordError)}
                    aria-describedby={newPasswordError ? 'new-password-error' : undefined}
                    value={newPassword}
                    onChange={(event) => {
                      const nextNewPassword = event.target.value
                      setNewPassword(nextNewPassword)
                      setNewPasswordError('')
                      checkPasswordsMatch(nextNewPassword, confirmPassword)
                    }}
                  />
                  <EyeButton
                    shown={showNewPassword}
                    onToggle={() => setShowNewPassword((value) => !value)}
                    label="新密码"
                  />
                </span>
              </label>
              {newPasswordError ? (
                <p id="new-password-error" className="login__error" aria-live="polite">
                  {newPasswordError}
                </p>
              ) : null}

              <label className="login__field" htmlFor="confirm-password">
                <span className="login__label">确认新密码</span>
                <span className="login__box">
                  <input
                    id="confirm-password"
                    className="login__input"
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirm-password"
                    placeholder="再输入一次密码"
                    autoComplete="new-password"
                    aria-invalid={Boolean(confirmPasswordError)}
                    aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
                    value={confirmPassword}
                    onChange={(event) => {
                      const nextConfirmPassword = event.target.value
                      setConfirmPassword(nextConfirmPassword)
                      checkPasswordsMatch(newPassword, nextConfirmPassword)
                    }}
                    onBlur={() => checkPasswordsMatch()}
                  />
                  <EyeButton
                    shown={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((value) => !value)}
                    label="确认密码"
                  />
                </span>
              </label>
              {confirmPasswordError ? (
                <p id="confirm-password-error" className="login__error" aria-live="polite">
                  {confirmPasswordError}
                </p>
              ) : null}

              <button className="login__submit" type="submit" disabled={submitting}>
                {submitting ? '正在设置' : '设置密码并进入创作'}
              </button>
            </form>
          </section>
        ) : null}

        {/* 稿子那一行页脚，一个字没改。★ 这里刻意**不写**"登录后会回到刚才那一页"：
            那一行字是给读屏与路过的眼睛看的，而 `next` 的去向在点「请登录」那一刻
            就已经定了（侧栏把当前路径编码进去），登录页再说一遍只是把一句已经成立的事
            讲第二遍。真想知道去哪儿，地址栏里写着 */}
        <p className="login__foot">以他为主角、用你的声音朗读的定制绘本</p>
      </section>

      <figure className="login__art">
        {/* ★ 两张都在 DOM 里，由 CSS 决定谁可见（见 login.css 文件头最后一段）。
            默认这张图：服务端渲染、禁 JS、reduced-motion 三种情形都拿到它 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="login__art-media login__still"
          src="/art/picnic-loop.webp"
          alt="水彩画：男孩躺在草地的野餐垫上，小狗趴在旁边，天上的云是恐龙和帆船的形状"
          width={960}
          height={960}
        />
        <video
          className="login__art-media login__video"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          src="/art/picnic-loop.mp4"
        />
        <figcaption className="login__caption">说一个名字，得到一本以他为主角的书。</figcaption>
      </figure>
    </main>
  )
}
