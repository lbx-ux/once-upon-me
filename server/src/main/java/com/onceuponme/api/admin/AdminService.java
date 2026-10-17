package com.onceuponme.api.admin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.admin.dto.AdminOverview;
import com.onceuponme.api.admin.dto.AdminUserRow;
import com.onceuponme.api.auth.AccountRules;
import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.DemoAccount;
import com.onceuponme.api.auth.PermissionRequest;
import com.onceuponme.api.auth.Permissions;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;
import com.onceuponme.api.auth.UserPermission;
import com.onceuponme.api.auth.mapper.PermissionRequestMapper;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.auth.mapper.UserPermissionMapper;
import com.onceuponme.api.auth.sms.SmsRateLimiter;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

/**
 * 管理页那两件事：列出所有人、改一个人的四个开关。
 *
 * <p>★ 两个不显然的地方：
 *
 * <p>1. <b>用户与权限分两次查，再在内存里拼</b>，而不是写一句 JOIN。
 * 用户数是"几个人"，权限表是"几行"——几百行的规模下，两次查询与一次 JOIN
 * 的差别量不出来，而 JOIN 之后要自己把结果映射成一个复合对象，
 * 那正是 MyBatis 最容易写错、也最难看出来的一处。真正该换的时机是
 * "这一屏开始分页"。
 *
 * <p>2. <b>缺权限行的人按"四个全关"显示</b>（{@link Permissions#none()}），
 * 而不是显示成"没有权限数据"。前者是这个项目的口径（新用户零权限），
 * 后者会让管理页上出现一行看不懂的空格子。<b>保存时会补上这一行</b>，
 * 所以"缺行"只会出现在"这个号是更早的版本建的"这种情况下。
 */
@Service
public class AdminService {

  private final UserMapper users;
  private final UserPermissionMapper permissions;
  /** ★ 删号时要把它带到别处去（见 {@link #deleteUser}） */
  private final PermissionRequestMapper permissionRequests;
  private final SmsRateLimiter rateLimiter;
  private final AuthService auth;
  private final AppProperties properties;
  /** 建号与重置密码要用它。★ 只在服务端出现，口令明文到这一层为止 */
  private final PasswordEncoder encoder;

  public AdminService(
      UserMapper users,
      UserPermissionMapper permissions,
      PermissionRequestMapper permissionRequests,
      SmsRateLimiter rateLimiter,
      AuthService auth,
      AppProperties properties,
      PasswordEncoder encoder) {
    this.users = users;
    this.permissions = permissions;
    this.permissionRequests = permissionRequests;
    this.rateLimiter = rateLimiter;
    this.auth = auth;
    this.properties = properties;
    this.encoder = encoder;
  }

  public AdminOverview overview() {
    List<User> all =
        users.selectList(Wrappers.<User>lambdaQuery().orderByDesc(User::getCreatedAt));
    Map<Long, UserPermission> byUser =
        permissions.selectList(null).stream()
            .collect(Collectors.toMap(UserPermission::getUserId, Function.identity(), (a, b) -> a));

    List<AdminUserRow> rows = new ArrayList<>(all.size());
    for (User user : all) {
      UserPermission row = byUser.get(user.getId());
      rows.add(
          AdminUserRow.of(user, row == null ? Permissions.none() : row.toPermissions()));
    }

    AppProperties.Sms sms = properties.sms();
    return new AdminOverview(
        rows,
        rateLimiter.todayCount(),
        sms == null ? 0 : sms.globalDaily(),
        auth.registrationOpen(),
        DemoAccount.ACCOUNT);
  }

  /**
   * 改一个人的四个开关。★ 全量替换（见 {@code PermissionPatch} 上那段），
   * 并且**立刻**在返回里带上这个人现在的样子：管理页把那四个 checkbox 重绘成
   * 服务端说的那一份，而不是继续显示本地那一份——否则一次失败（比如网络断了）
   * 会让界面看起来"改成功了"。
   */
  @Transactional
  public AdminUserRow updatePermissions(long userId, Permissions next) {
    User user = users.selectById(userId);
    if (user == null) {
      throw ApiException.notFound("user-not-found", "找不到这个账号");
    }

    UserPermission row = permissions.selectById(userId);
    if (row == null) {
      row = UserPermission.noneFor(userId, Times.now());
    }
    row.setCanText(next.text());
    row.setCanImage(next.image());
    row.setCanVision(next.vision());
    row.setCanSpeech(next.speech());
    row.setUpdatedAt(Times.now());

    if (permissions.selectById(userId) == null) {
      permissions.insert(row);
    } else {
      permissions.updateById(row);
    }
    return AdminUserRow.of(user, row.toPermissions());
  }

  /* ── 建号 / 停号 / 删号 / 重置别人的密码（2026-10-17，用户要的）──────────────
   *
   * ★ 四条动作共同的一条纪律：**每一条都要问一句"这个动作会不会把最后一个管理员弄没"**。
   *   管理页是这一轮唯一一处能改权限的地方，把最后那个管理员停掉或删掉之后，
   *   就再没有任何界面手段能把它加回来——只能去库里改。那不是"少一个功能"，
   *   是把自己锁在门外，而它一旦发生就只能靠手工 SQL 救。
   */

  /**
   * 建一个号。
   *
   * ★ **新号的四个能力一律不开**（`Permissions.none()`）。这是"按能力授权"那条产品口径的
   * 直接后果：默认给点什么，就等于把"要不要给他"这个决定悄悄替站长做了。
   * 建完在那一行上勾，是两步，但两步各是一个决定。
   */
  @Transactional
  public AdminUserRow createUser(String account, String password) {
    String name = account == null ? "" : account.trim();
    AccountRules.requireAccount(name);
    AccountRules.requirePassword(password);
    if (byAccount(name) != null) {
      throw ApiException.badRequest("account-taken", "这个账号已经有人用了");
    }

    User user = new User();
    user.setAccount(name);
    // ★ 手机号只在"这个登录名本身长得像手机号"时才填：短账号（`123456` 那类）
    //   没有手机号，而把 `123456` 塞进 phone 会让后端以为它能收短信
    user.setPhone(AccountRules.isPhone(name) ? name : null);
    user.setPasswordHash(encoder.encode(password));
    user.setNickname("");
    user.setAvatar("");
    user.setRole("USER");
    user.setStatus(User.STATUS_ACTIVE);
    user.setCreatedAt(Times.now());
    users.insert(user);

    Permissions none = Permissions.none();
    permissions.insert(UserPermission.noneFor(user.getId(), Times.now()));
    return AdminUserRow.of(user, none);
  }

  /**
   * 停号 / 复号。
   *
   * ★ 停的那一刻**顺手把密码代次顶一下**（`passwordChangedAt = now`）：那一列的作用是
   * "早于它的票一律作废"，于是这个人在别处已经登着的会话**当场**失效——而不是等它们
   * 各自过期。复号时**不再动它**：那一位只该往前走，往回拨等于让一批已经作废的票复活。
   */
  @Transactional
  public AdminUserRow setStatus(long userId, String status, long actorId) {
    boolean active = User.STATUS_ACTIVE.equals(status);
    if (!active && !User.STATUS_DISABLED.equals(status)) {
      throw ApiException.badRequest("bad-status", "状态只有 ACTIVE 与 DISABLED 两种");
    }
    User user = requireUser(userId);
    if (!active) {
      guardNotLastAdmin(user, actorId, "停用");
    }
    user.setStatus(active ? User.STATUS_ACTIVE : User.STATUS_DISABLED);
    if (!active) {
      user.setPasswordChangedAt(Times.now());
    }
    users.updateById(user);
    return AdminUserRow.of(user, permissionsOf(userId));
  }

  /**
   * 删号。
   *
   * <p>★ <b>它删的是"这个账号"，不是"这个人的东西"</b>：作品与角色卡此刻还挂不到人身上
   * （没有 owner 那一列，见工单 16），所以删号<b>不会</b>带走他做过的绘本。
   * 这句话必须写在代码里而不是只在文档里——等 owner 那一列落地之后，
   * 这个方法的语义要重新想一遍（那时它才真的面临"他的书怎么办"）。
   *
   * <p>★ <b>而权限申请跟着走</b>（2026-10-17 端到端验出来的那个 bug）：
   * 申请那一行是唯一一处会把"申请人"显示出来的地方，而它显示的是 `users` 表里
   * 那个账号本身——账号没了，那一行的 `account` 就是一个空串。
   * 不带走的话，管理页上会出现几条**看不出是谁**的申请，而更坏的是：
   * 空白账号在 `parseRequestRow` 里是"这一行读不出来"，于是整个申请列表
   * 会整份拒绝渲染——站长看到的是"读不到申请列表"，而它其实好好的，
   * 只是里面混进了两个孤儿。**删一个号不该毁掉整列申请。**
   * （这里没有外键、没有级联：这个库的 DDL 刻意只有 `IF NOT EXISTS`，
   * 所以"一起删"这件事必须在代码里写出来。）
   *
   * <p>★ <b>演示账号删不掉</b>，而且要说清为什么：`AccountSeeder` 每次启动都会把它补回来，
   * 所以"删掉它"是一次会自己撤销的动作。给一个按下去会自己弹回来的按钮，
   * 比不给这个按钮坏——它会让人以为"演示账号已经没了"，而它还在花站长的钱。
   */
  @Transactional
  public void deleteUser(long userId, long actorId) {
    User user = requireUser(userId);
    if (DemoAccount.ACCOUNT.equals(user.getAccount())) {
      throw ApiException.badRequest(
          "demo-account",
          "演示账号删了会在下次启动时长回来（AccountSeeder），要真停掉它得改配置");
    }
    guardNotLastAdmin(user, actorId, "删掉");
    // ★ 三张表一起清：他手里的权限、他提过的申请、他自己。
    //   顺序不重要（没有外键），但**一条都不能漏**——漏掉申请那一条的后果见上面那段
    permissionRequests.delete(
        Wrappers.<PermissionRequest>lambdaQuery().eq(PermissionRequest::getUserId, userId));
    permissions.deleteById(userId);
    users.deleteById(userId);
  }

  /**
   * 替一个人重置密码。
   *
   * ★ 与"自己改密码"那条（`AuthService#changePassword`）差两件事，都是刻意的：
   *   1. **不要旧密码**——要它就没法用了（忘了密码的人恰恰是不知道旧密码的那个）；
   *   2. **回一句话，不回新密码**：口令是站长输进来的，服务端不生成、也不回显。
   *      服务端生成口令的话，它就得在一处被读到（日志/响应/内存），而"没有一份要删的副本"
   *      是这个仓库在密钥与录音样本上已经用过两次的做法。
   * ★ 顶密码代次（同 `setStatus`）：他手上那些旧票当场作废。这也正是"重置"该有的效果——
   *   不然站长帮他改完，那个知道他旧密码的人照旧能用。
   */
  @Transactional
  public AdminUserRow resetPassword(long userId, String password) {
    AccountRules.requirePassword(password);
    User user = requireUser(userId);
    user.setPasswordHash(encoder.encode(password));
    user.setPasswordChangedAt(Times.now());
    users.updateById(user);
    return AdminUserRow.of(user, permissionsOf(userId));
  }

  /** 管理动作里的那个"人"。找不到就是 404，与 `updatePermissions` 同一句 */
  private User requireUser(long userId) {
    User user = users.selectById(userId);
    if (user == null) {
      throw ApiException.notFound("user-not-found", "找不到这个账号");
    }
    return user;
  }

  private Permissions permissionsOf(long userId) {
    UserPermission row = permissions.selectById(userId);
    return row == null ? Permissions.none() : row.toPermissions();
  }

  private User byAccount(String account) {
    return users.selectOne(Wrappers.<User>lambdaQuery().eq(User::getAccount, account));
  }

  /**
   * 这个动作会不会把最后一个还能用的管理员弄没。
   *
   * ★ 两条都要：**不能动自己**（一个手滑就把自己关在门外，而管理页是唯一能开权限的地方），
   * **不能动最后一个**（有两个管理员时互相停都还行，剩一个时就不行）。
   * 前一条其实被后一条覆盖了一半（只剩你一个管理员时，动自己就是动最后一个），
   * 但两个管理员时你仍然不该能停自己——那时你只是把自己弄进了"要找另一个人帮忙"的境地。
   */
  /**
   * 这个动作会不会把最后一个还能用的管理员弄没。
   *
   * ★ 两条都要：**不能动自己**（一个手滑就把自己关在门外，而管理页是唯一能开权限的地方），
   * **不能动最后一个**（有两个管理员时互相停都还行，剩一个时就不行）。
   * 前一条其实被后一条覆盖了一半（只剩你一个管理员时，动自己就是动最后一个），
   * 但两个管理员时你仍然不该能停自己——那时你只是把自己弄进了"要找另一个人帮忙"的境地。
   *
   * ★ 而**已经停用的管理员不在保护范围里**（2026-10-17 写这条测试时发现的）：
   *   保护的是"还能用的管理员的数量"，一个停用的人本来就没被算进去——
   *   不放行的话会出现一个说不通的局面：A 停用了 B，然后**删不掉 B**
   *   （因为"别的还能用的管理员"是 0），于是 B 永远赖在列表里。
   *   判据是"这个目标此刻算不算一个能用的管理员"，不是"它是不是 ADMIN"。
   */
  private void guardNotLastAdmin(User target, long actorId, String action) {
    if (target.getId() != null && target.getId() == actorId) {
      throw ApiException.badRequest("self-target", "不能" + action + "自己");
    }
    if (!"ADMIN".equals(target.getRole()) || !User.isActive(target)) {
      return;
    }
    long otherActiveAdmins =
        users.selectList(
                Wrappers.<User>lambdaQuery()
                    .eq(User::getRole, "ADMIN")
                    .eq(User::getStatus, User.STATUS_ACTIVE)
                    .ne(User::getId, target.getId()))
            .size();
    if (otherActiveAdmins == 0) {
      throw ApiException.badRequest("last-admin", "这是最后一个管理员，" + action + "之后就没人能改权限了");
    }
  }
}
