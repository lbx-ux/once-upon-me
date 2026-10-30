package com.onceuponme.api.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.auth.mapper.UserPermissionMapper;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.credit.CreditService;

/**
 * 启动时把那两个"一建好就该在"的账号补上：演示账号与管理员。
 *
 * <p>★ 三条判断，都关于"什么时候**不**动手"：
 *
 * <p>1. <b>已经在库里就一个字段都不改</b>。尤其是口令：管理员（= 站长本人）改了密码之后，
 * 每次重启把它冲回配置文件里那个初始值，是一个看起来不像 bug 的严重问题——
 * 而它会以"我明明改过密码"的形式出现，让人先怀疑输入法。
 *
 * <p>2. <b>没配管理员就跳过并说清楚</b>，绝不自己编一个默认口令。
 * 一个众所周知的默认管理员入口，比"暂时没有管理员"坏得多。
 *
 * <p>3. <b>演示账号的口令是公开的，所以每次启动都要把这句话喊一遍</b>。
 * 它带着创作权，而站是挂在公网上的——这条日志是唯一一处会主动告诉站长
 * "现在有人在替你花钱"的地方。
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 100)
public class AccountSeeder implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(AccountSeeder.class);

  /**
   * 演示账号开局给几本。★ 这不是"送"，是**评审期要有东西可点**：
   * 一本 20 页实测 5.8–11.6 元，20 本是一笔明确的运营成本，所以它是常量、写在代码里，
   * 而不是"按需自动加"——后者会在没人注意的时候一直加。
   * 评审结束那天把这个账号停掉（`DemoAccount#howToDisable`），这笔钱就停了。
   */
  static final int DEMO_BOOKS = 20;

  private final UserMapper users;
  private final UserPermissionMapper permissions;
  private final PasswordEncoder encoder;
  private final AppProperties properties;
  private final CreditService credits;

  public AccountSeeder(
      UserMapper users,
      UserPermissionMapper permissions,
      PasswordEncoder encoder,
      AppProperties properties,
      CreditService credits) {
    this.users = users;
    this.permissions = permissions;
    this.encoder = encoder;
    this.properties = properties;
    this.credits = credits;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    seedDemoAccount();
    seedAdmin();
  }

  private void seedDemoAccount() {
    if (byAccount(DemoAccount.ACCOUNT) == null) {
      User demo = newUser(DemoAccount.ACCOUNT, DemoAccount.PASSWORD, "USER");
      permissions.insert(UserPermission.allowedFor(demo.getId(), Times.now()));
      log.info("已建演示账号 {}（有创作权，口令就是用户名）", DemoAccount.ACCOUNT);
    }
    // ★ 不管账号是这一次建的还是早就在，额度都补一次（只补一次）。
    //   只写在"新建"那一支里的话，已经在库里的演示账号会一本都没有——
    //   而那正是部署这一版之后最常见的情形
    User demo = byAccount(DemoAccount.ACCOUNT);
    if (demo != null) {
      credits.ensureAccount(demo.getId(), 0, "开户");
      credits.ensureGrantOnce(demo.getId(), DEMO_BOOKS, "demo", "演示账号的创作额度");
    }
    log.warn(
        "演示账号 {} 的口令是公开的，而它有创作权——外人在站上生成绘本花的是你的钱。要停掉：{}",
        DemoAccount.ACCOUNT,
        DemoAccount.howToDisable());
  }

  private void seedAdmin() {
    AppProperties.Admin admin = properties.admin();
    String account = admin == null ? null : admin.account();
    String password = admin == null ? null : admin.password();

    // ★ 这里不自己校验账号形状：它由 StartupChecks 在启动时把关（那一条注释里写了
    //   为什么必须有它——"库里有一个永远登不进去的管理员"是实测撞到过的）。
    //   同一个规则写两遍的那天起，两处就会开始不一样
    if (account == null || account.isBlank() || password == null || password.isBlank()) {
      log.warn(
          "没有配管理员账号（APP_ADMIN_ACCOUNT / APP_ADMIN_PASSWORD）：管理页将没有人能进。"
              + "要开就配这两个值再重启一次——已经建过的管理员不会被重启改掉口令。");
      return;
    }
    if (byAccount(account) != null) {
      return;
    }
    User created = newUser(account, password, "ADMIN");
    permissions.insert(UserPermission.allowedFor(created.getId(), Times.now()));
    credits.ensureAccount(created.getId(), 0, "开户");
    log.info("已建管理员账号 {}（口令来自配置，不在仓库里）", account);
  }

  private User newUser(String account, String rawPassword, String role) {
    User user = new User();
    user.setAccount(account);
    user.setPhone(AccountRules.isPhone(account) ? account : null);
    user.setPasswordHash(encoder.encode(rawPassword));
    user.setNickname("");
    user.setAvatar("");
    user.setRole(role);
    user.setCreatedAt(Times.now());
    users.insert(user);
    return user;
  }

  private User byAccount(String account) {
    return users.selectOne(Wrappers.<User>lambdaQuery().eq(User::getAccount, account));
  }
}
