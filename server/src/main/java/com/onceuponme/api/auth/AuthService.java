package com.onceuponme.api.auth;

import java.time.LocalDateTime;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.auth.dto.CodeVerdict;
import com.onceuponme.api.auth.dto.IssuedSession;
import com.onceuponme.api.auth.dto.SendCodeResult;
import com.onceuponme.api.auth.dto.UserView;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.auth.mapper.UserPermissionMapper;
import com.onceuponme.api.auth.sms.DevSmsCodeSender;
import com.onceuponme.api.auth.sms.SmsCodeSender;
import com.onceuponme.api.auth.sms.SmsRateLimiter;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

/**
 * 登录这件事的全部规则。**一个进程里只有这一处**决定"谁能进来、以什么身份进来"。
 *
 * <p>★ 三条贯穿全文件的判断：
 *
 * <p>1. <b>没设过密码的人不许走密码登录</b>，而这条判据是
 * {@code passwordHash == null}，不是"密码是空串"。
 *
 * <p>2. <b>账号是在<em>设密码那一刻</em>才建的</b>（不是"验证码通过就建"）。
 * 一个人发一次码又走了，不该在你的库里留下一行记录——那样"这个站上有多少用户"
 * 这个数会变成一个虚数，而这个数在管理页上要给人看。
 *
 * <p>3. <b>失败的顺序是有讲究的</b>：先看有没有设过密码，再看密码对不对。
 * 反过来（先比密码）会让"这个号还没设过密码"被一句"密码不对"盖住，
 * 而那两句话对用户来说是**两件不同的事**（一件是"你该走验证码"，一件是"你再想想"）。
 */
@Service
public class AuthService {

  private final UserMapper users;
  private final UserPermissionMapper permissions;
  private final SmsCodeSender smsSender;
  private final SmsRateLimiter rateLimiter;
  private final JwtService jwt;
  private final LoginAttemptGuard guard;
  private final PasswordEncoder encoder;
  private final AppProperties properties;

  public AuthService(
      UserMapper users,
      UserPermissionMapper permissions,
      SmsCodeSender smsSender,
      SmsRateLimiter rateLimiter,
      JwtService jwt,
      LoginAttemptGuard guard,
      PasswordEncoder encoder,
      AppProperties properties) {
    this.users = users;
    this.permissions = permissions;
    this.smsSender = smsSender;
    this.rateLimiter = rateLimiter;
    this.jwt = jwt;
    this.guard = guard;
    this.encoder = encoder;
    this.properties = properties;
  }

  /* ── 第一步：发验证码 ───────────────────────────────────────────────────── */

  public SendCodeResult sendCode(String account, String ip) {
    String name = trimmed(account);
    AccountRules.requireAccount(name);

    // ★ 短账号（比如演示账号 123456）不能收短信，这一点是**结构上**的：
    //   判据是"它是不是一个手机号"，而不是某个 if 里记着别给 123456 发
    if (!AccountRules.isPhone(name)) {
      throw ApiException.badRequest("not-a-phone", "这个账号不是手机号，请直接用密码登录");
    }

    // ★ 先看注册开关，再看频控：注册关掉时，连"发一条试试"都不该发生（那是钱）
    User existing = byAccount(name);
    if (existing == null && !registrationOpen()) {
      throw ApiException.forbidden("registration-closed", "现在不开放新用户注册，请联系管理员");
    }

    rateLimiter.check(name, ip);
    smsSender.send(name);
    // ★ 记在**发出之后**：被上面任何一条挡下的请求都不记账，
    //   否则一个人连点五下会把"今天的额度"用光，而他一条短信都没收到
    rateLimiter.record(name, ip);

    if (smsSender.devMode()) {
      // ★ 这句是给界面直接显示的。开发模式**必须**说出来（见 DevSmsCodeSender）
      return SendCodeResult.devSent("开发模式：没有真正发送短信，验证码固定 " + DevSmsCodeSender.DEV_CODE);
    }
    return SendCodeResult.sent();
  }

  /* ── 第二步：核验验证码 ─────────────────────────────────────────────────── */

  @Transactional
  public CodeVerdict verifyCode(String account, String code) {
    String name = trimmed(account);
    AccountRules.requireAccount(name);
    AccountRules.requireCode(code);
    if (!AccountRules.isPhone(name)) {
      throw ApiException.badRequest("not-a-phone", "这个账号不是手机号，请直接用密码登录");
    }

    if (!smsSender.verify(name, code)) {
      throw ApiException.badRequest("bad-code", "验证码不对，或者已经过期了");
    }

    User user = byAccount(name);
    if (user == null) {
      // ★ 不建号：只发一张 5 分钟的票，等他把密码设了再说（见文件头第 2 条）
      return CodeVerdict.needsPassword(jwt.signTicket(name));
    }
    // ★ 停用的号不许在这里拿到会话（2026-10-22 审查）。密码登录那条路查了
    //   `isActive`，验证码这条路原来没查——一个被停用的号用验证码还能签出一张
    //   7 天的票，而"停号此刻就进不来"是这一层写在注释里的承诺。
    //   文案与"验证码不对"刻意一致：否则等于向任何会猜账号的人确认这个号存在。
    if (!User.isActive(user)) {
      throw ApiException.badRequest("bad-code", "验证码不对，或者已经过期了");
    }
    return CodeVerdict.signedIn(viewOf(user), touchLogin(user));
  }

  /* ── 第三步：新用户设密码 ───────────────────────────────────────────────── */

  @Transactional
  public IssuedSession setPassword(String ticket, String password) {
    String account = jwt.verifyTicket(ticket);
    AccountRules.requirePassword(password);

    User user = byAccount(account);
    if (user != null && user.getPasswordHash() != null) {
      // ★ 已经设过的人再调一次，是**错误**而不是"重设"：这一轮没有找回密码，
      //   而"能用验证码改掉别人的密码"正是这条接口最危险的一种被误用
      throw ApiException.badRequest("password-already-set", "这个号码已经设过密码了，直接登录就行");
    }
    if (user == null) {
      if (!registrationOpen()) {
        throw ApiException.forbidden("registration-closed", "现在不开放新用户注册，请联系管理员");
      }
      user = createUser(account);
    }

    user.setPasswordHash(encoder.encode(password));
    users.updateById(user);

    return new IssuedSession(touchLogin(user), viewOf(user));
  }

  /* ── 另一条入口：密码登录 ───────────────────────────────────────────────── */

  @Transactional
  public IssuedSession login(String account, String password) {
    String name = trimmed(account);
    AccountRules.requireAccount(name);
    guard.check(name);

    User user = byAccount(name);
    // ★ "这个号还没设过密码"是一句**真话**，也正是真后端会说的话（前端那条模拟
    //   契约里本来就是这一句）。代价是它泄露了"这个号存不存在"——这一轮认了：
    //   账号就是手机号，存在性本来就不难猜，而一句含糊的"账号或密码不对"
    //   会让真正该走验证码的人在这里卡住。连错锁定（guard）是这条代价的对冲
    if (user == null || user.getPasswordHash() == null) {
      guard.recordFailure(name);
      throw ApiException.badRequest("no-password", "这个号码还没设过密码，先用验证码登录");
    }
    if (!encoder.matches(password, user.getPasswordHash())) {
      guard.recordFailure(name);
      throw ApiException.badRequest("bad-password", "密码不对");
    }

    // ★ 停用的号口径是"密码也不对"，不是"你被停用了"。两句不同的话是有意的：
    //   说"这个号被停用了"等于向任何一个会猜账号的人确认这个号存在、而且它曾经能用。
    //   ★ 它**不进** `guard`（不记一次失败）：被停用的人多半是本人，而他无论输对输错
    //   都进不来——记账只会让一个正在被停用的人连着把号锁上，那是纯粹的坏。
    //   没权限的那件事，站长在管理页上会告诉他。
    if (!User.isActive(user)) {
      throw ApiException.badRequest("bad-password", "密码不对");
    }

    guard.clear(name);
    return new IssuedSession(touchLogin(user), viewOf(user));
  }

  /* ── 登录之后：看自己、改自己 ───────────────────────────────────────────── */

  public UserView me(JwtService.Session session) {
    return viewOf(requireUser(session));
  }

  @Transactional
  public UserView updateNickname(JwtService.Session session, String nickname) {
    User user = requireUser(session);
    String value = nickname == null ? "" : nickname.trim();
    if (value.length() > AccountRules.NICKNAME_MAX) {
      throw ApiException.badRequest("nickname-too-long", "昵称最多 " + AccountRules.NICKNAME_MAX + " 个字");
    }
    // ★ 空串照写：它是"还没起过"，是一件允许发生的事
    user.setNickname(value);
    users.updateById(user);
    return viewOf(user);
  }

  @Transactional
  public UserView pickAvatar(JwtService.Session session, String avatar) {
    User user = requireUser(session);
    AccountRules.requireAvatarId(avatar);
    user.setAvatar(avatar);
    users.updateById(user);
    return viewOf(user);
  }

  /* ── 给别处用的读法 ─────────────────────────────────────────────────────── */

  /**
   * 会话 → 这个人。**所有要认人的接口都从这一处过**，因为它同时回答两个问题：
   * "这个账号还在吗"与"**这张票是不是签发在最后一次改密码之前**"。
   *
   * <p>★ 后一条是"改密码"这件事的另一半。我们没有 token 黑名单，所以撤销会话只有
   * 一个办法：把"密码什么时候改的"记下来（`users.password_changed_at`），
   * 比它早签发的票一律作废。没有它的话，一个人改完密码，
   * 别处那些已经登着的会话照旧能用——而"改密码"有一半的场景就是"有人知道我旧密码"。
   *
   * <p>★ 边界说清楚：能撤销的是**所有经过服务端的判断**（`/me`、改昵称、换头像、
   * 管理接口，以及 BFF 在每一个要花钱的接口前问的那一次 `/me`）。
   * 纯页面读取不在这条路上（那是 Next 那一侧本地验票就放的），
   * 所以"撤销"对钱和写操作是即时生效的，对"看一页书"不是。这一条写在 README §五。
   */
  public User requireUser(JwtService.Session session) {
    User user = users.selectById(session.userId());
    if (user == null) {
      // ★ 票是有效的、但人没了（被删号，或者库被换过）：这不是"没登录"，
      //   所以不是 401 的一句"请登录"，而是一句说得清的 401
      throw ApiException.unauthorized("这个账号已经不在了，请重新登录");
    }
    /*
     * ★ 停用的号，**此刻**就进不来（2026-10-17，管理页的"停号"）。
     *
     * ★ 这一句必须排在**密码代次那一句之前**，而且这个次序是实测出来的
     * （`AdminUsersIntegrationTest#disablingKillsLiveSessionsImmediately` 第一版就红在这儿）：
     * 停号会顺手把 `passwordChangedAt` 顶一下（见 `AdminService#setStatus`），
     * 于是下面那条"密码改过了"也会命中——两句都是 401，可**报出去的那一句是错的**。
     * 被停用的人会看到"密码改过了，请重新登录"，然后拿同一个密码反复试，
     * 永远不知道自己是被停用了。两句都对，但一句有用、一句误导。
     *
     * ★ 这句话是**说给本人听的**，所以与登录那一条不同，可以说实话：
     * 他手里已经有一张有效的票（证明过身份），含糊其辞只会让他以为是坏了。
     * 而登录那条（还没有票、也就还没证明身份）回的是"密码不对"——两处的口径不同是有意的。
     */
    if (!User.isActive(user)) {
      throw ApiException.unauthorized("这个账号已被停用，请联系管理员");
    }
    // ★ 判据是"票里的密码代次与库里现在这一代是否相等"，**不是**比时间（见 JwtService 上那段）
    if (session.passwordVersion() != passwordVersionOf(user)) {
      throw ApiException.unauthorized("密码改过了，请重新登录");
    }
    return user;
  }

  /** 这一代密码的版本号。与 `JwtService` 算的是同一个值（那边签票时写进去，这边核对） */
  private static long passwordVersionOf(User user) {
    return user.getPasswordChangedAt() == null
        ? 0L
        : user.getPasswordChangedAt().atZone(Times.ZONE).toEpochSecond();
  }

  /** 只有"确实要看这个人"的地方才用得到（防止有人从 `requireUser(Session)` 又滑回按 id 取） */
  public User requireUserById(long userId) {
    User user = users.selectById(userId);
    if (user == null) {
      throw ApiException.unauthorized("这个账号已经不在了，请重新登录");
    }
    return user;
  }

  /**
   * 改密码。三条判断，每条都有理由：
   *
   * <p>1. <b>要现在的密码</b>。只要拿着会话就能改密码的话，一个被借走的 cookie
   * 就等于账号本身。而这一条也顺势把"有会话"与"是本人"分开了。
   * <p>2. <b>错三次以上就锁</b>（复用登录那把 `LoginAttemptGuard`）。
   * 否则这个接口就是一把**不限速的密码验证器**：拿着一个偷来的会话在那里慢慢试口令。
   * <p>3. <b>新密码不能与现在的一样</b>。"改"成一个相同的值看着像成功、实际上什么都没变，
   * 而它还会把别处的会话全踢掉——一件纯有害的事。
   *
   * <p>★ 改完回一张**新票**：改密码的人自己不该被踢出去（他刚证明了他是本人）。
   * 别处的旧票按 `password_changed_at` 作废。
   */
  @Transactional
  public IssuedSession changePassword(
      JwtService.Session session, String currentPassword, String nextPassword) {
    User user = requireUser(session);
    AccountRules.requirePassword(nextPassword);

    if (user.getPasswordHash() == null) {
      // 走验证码进来、还没设过密码的账号（这一轮不该存在，但类型上是可空的）
      throw ApiException.badRequest("no-password", "这个账号还没设过密码，先用验证码登录并设一个");
    }

    guard.check(user.getAccount());
    if (!encoder.matches(currentPassword, user.getPasswordHash())) {
      guard.recordFailure(user.getAccount());
      throw ApiException.badRequest("bad-password", "现在的密码不对");
    }
    if (encoder.matches(nextPassword, user.getPasswordHash())) {
      throw ApiException.badRequest("same-password", "新密码和现在这个一样，换一个吧");
    }
    guard.clear(user.getAccount());

    user.setPasswordHash(encoder.encode(nextPassword));
    // ★ 记下这一刻：比它早签发的票从此作废（见 `requireUser`）
    user.setPasswordChangedAt(Times.now());
    users.updateById(user);

    return new IssuedSession(jwt.signSession(user), viewOf(user));
  }

  /**
   * 这个人现在有没有创作权。★ **每次从库里读**，不从票里读——
   * 站长在管理页上把权限收回去之后，那个人下一次点「开始创作」就要看见变化，
   * 而不是等 7 天票过期。
   *
   * <p>★ <b>缺行 = 有</b>（不是"没有"）：默认是给上的（见 {@code UserPermission} 与
   * `schema.sql` 里那一列上的 {@code DEFAULT 1}），所以"没有那一行"与"没被收回过"
   * 是同一件事——而这个判断只写在这一处，管理页与那道闸都问它。
   */
  public boolean allowedOf(long userId) {
    UserPermission row = permissions.selectById(userId);
    return row == null || row.isAllowed();
  }

  public UserView viewOf(User user) {
    return UserView.of(user, allowedOf(user.getId()));
  }

  public boolean registrationOpen() {
    AppProperties.Sms sms = properties.sms();
    return sms == null || sms.registrationOpen();
  }

  /* ── 内部零件 ───────────────────────────────────────────────────────────── */

  private User byAccount(String account) {
    return users.selectOne(Wrappers.<User>lambdaQuery().eq(User::getAccount, account));
  }

  /** 建号。★ 权限按**默认给上**建（见 {@code UserPermission#allowedFor}）：登录即全开 */
  private User createUser(String account) {
    User user = new User();
    user.setAccount(account);
    user.setPhone(AccountRules.isPhone(account) ? account : null);
    user.setNickname("");
    user.setAvatar("");
    user.setRole("USER");
    user.setCreatedAt(Times.now());
    users.insert(user);

    permissions.insert(UserPermission.allowedFor(user.getId(), Times.now()));
    return user;
  }

  /** 记一次"这个人来过"，并回一张会话票 */
  private String touchLogin(User user) {
    user.setLastLoginAt(Times.now());
    users.updateById(user);
    return jwt.signSession(user);
  }

  private static String trimmed(String value) {
    return value == null ? "" : value.trim();
  }
}
