package com.onceuponme.api.credit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import com.onceuponme.api.auth.DemoAccount;
import com.onceuponme.api.auth.User;
import com.onceuponme.api.auth.mapper.UserMapper;

/**
 * 上线这一版时，给<b>已经在库里的账号</b>补一个额度户头。
 *
 * <p>★ 为什么需要它：额度表是新加的，而老账号一行都没有。缺行按 0 算的话，
 * 部署那一刻全站的人都画不了书——包括站长自己。所以这里给"上线前就在的人"
 * 补 {@link #STARTING_BOOKS} 本。
 *
 * <p>★ 为什么是 2 本而不是"按需自动加"：这是一次**迁移**，不是一条产品规则。
 * 迁移只该发生一次，判据是"这个人有没有户头"（有 = 迁移过了）。
 * 做成"余额不够就补"的话，花完再重启一次就又有了——那不是迁移，是漏洞。
 *
 * <p>★ 新注册的人不走这里：`AuthService#createUser` 建号时当场建一个 0 本的户头，
 * 于是启动扫描时他们"已经有户头"，不会被补。演示账号也不走这里
 * （{@code AccountSeeder} 给它 20 本，见那里的常量）。
 *
 * <p>★ 顺序排在最后：它要等 {@code SchemaUpgrades} 把表补齐、
 * {@code AccountSeeder} 把演示账号建好。见 {@code AccountSeeder} 上的 {@code @Order}。
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class CreditBootstrap implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(CreditBootstrap.class);

  /** 迁移时给老账号补几本。★ 2 本够"把手上那本做完 + 再试一本" */
  static final int STARTING_BOOKS = 2;

  private final UserMapper users;
  private final CreditService credits;

  public CreditBootstrap(UserMapper users, CreditService credits) {
    this.users = users;
    this.credits = credits;
  }

  @Override
  public void run(ApplicationArguments args) {
    int granted = 0;
    for (User user : users.selectList(null)) {
      if (DemoAccount.ACCOUNT.equals(user.getAccount())) continue;
      int before = credits.balanceOf(user.getId());
      credits.ensureAccount(user.getId(), STARTING_BOOKS, "上线前就有的账号，补 " + STARTING_BOOKS + " 本");
      if (credits.balanceOf(user.getId()) != before) granted++;
    }
    if (granted > 0) {
      // ★ 这是一次**对库的写**，而且动的是钱：日志里必须看得见
      log.warn("给 {} 个老账号补了额度户头（每个 {} 本）", granted, STARTING_BOOKS);
    }
  }
}
