package com.onceuponme.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 给已有的库补列。
 *
 * <p>★ 判据要挑那种**只有真做了才会不一样**的量：这条测试先造一个"加这一列之前"的
 * users 表，并且**先塞一行进去**，然后才跑补丁。于是它同时验三件事：
 * 列补上了、原来那行还在、再跑一遍不炸。只验"列在不在"的话，
 * 一个 `DROP TABLE` + `CREATE TABLE` 的实现也能把它骗过去——而那正是会吃掉数据的写法。
 */
class SchemaUpgradesTest {

  /** 一个"加 password_changed_at 之前"的 users 表，形状与真实那份一致但少了那一列 */
  private static JdbcDataSource legacyDatabase() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:schemaupgrade-test;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      statement.execute(
          "CREATE TABLE IF NOT EXISTS users ("
              + "id BIGINT NOT NULL AUTO_INCREMENT,"
              + "account VARCHAR(32) NOT NULL,"
              + "password_hash VARCHAR(100) DEFAULT NULL,"
              + "PRIMARY KEY (id))");
      statement.execute("DELETE FROM users");
      statement.execute("INSERT INTO users (account, password_hash) VALUES ('13700000000', 'x')");
    }
    return dataSource;
  }

  @Test
  @DisplayName("★ 老库缺那一列 → 补上；原来那行**还在**；再跑一遍不报错（幂等）")
  void addsMissingColumnWithoutTouchingData() throws Exception {
    JdbcDataSource dataSource = legacyDatabase();
    SchemaUpgrades upgrades = new SchemaUpgrades(dataSource);

    upgrades.run(null);

    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      assertThat(hasPasswordChangedAt(connection)).isTrue();

      try (ResultSet rows = statement.executeQuery("SELECT account FROM users")) {
        assertThat(rows.next()).as("补列不该动到原有的行").isTrue();
        assertThat(rows.getString("account")).isEqualTo("13700000000");
      }

      // 新列在旧行上是 NULL —— 意思是"从没改过密码"，而不是某个默认时刻
      try (ResultSet rows =
          statement.executeQuery("SELECT password_changed_at FROM users WHERE account = '13700000000'")) {
        rows.next();
        assertThat(rows.getObject(1)).isNull();
        assertThat(rows.wasNull()).isTrue();
      }
    }

    // ★ 每次启动都会跑它，所以第二遍必须是干净的 no-op
    assertThatCode(() -> upgrades.run(null)).doesNotThrowAnyException();
  }

  private static boolean hasPasswordChangedAt(Connection connection) throws Exception {
    try (ResultSet columns =
        connection.getMetaData().getColumns(connection.getCatalog(), null, null, null)) {
      while (columns.next()) {
        if ("users".equalsIgnoreCase(columns.getString("TABLE_NAME"))
            && "password_changed_at".equalsIgnoreCase(columns.getString("COLUMN_NAME"))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 历史坏值：音色那一行落下来时**没有名字**（2026-10-17 之前，
   * 界面按「选它」只送 voiceId，而预置音色是第一次被选中才落一行的）。
   *
   * <p>★ 判据挑的是"只有真修了才会不一样"的那些：空名字那一行**补成它自己的 id**、
   * 有名字那一行**一个字不动**、再跑一遍不报错。只验"没有空名字了"的话，
   * 一个 `DELETE FROM voices WHERE name = ''` 的实现也能过——而那是把用户的选择删掉。
   */
  @Test
  @DisplayName("★ 历史坏值：空名字那行补成它的 id、有名字的不动、再跑一遍不报错")
  void repairsBlankVoiceNames() throws Exception {
    JdbcDataSource dataSource = legacyDatabase();
    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      statement.execute(
          "CREATE TABLE IF NOT EXISTS voices ("
              + "id BIGINT NOT NULL AUTO_INCREMENT,"
              + "user_id BIGINT NOT NULL,"
              + "voice_id VARCHAR(64) NOT NULL,"
              + "name VARCHAR(64) NOT NULL,"
              + "model VARCHAR(64) DEFAULT NULL,"
              + "chosen BOOLEAN NOT NULL DEFAULT FALSE,"
              + "created_at DATETIME NOT NULL,"
              + "PRIMARY KEY (id))");
      statement.execute("DELETE FROM voices");
      statement.execute(
          "INSERT INTO voices (user_id, voice_id, name, chosen, created_at)"
              + " VALUES (1, 'longjielidou_v3.6', '', TRUE, CURRENT_TIMESTAMP)");
      statement.execute(
          "INSERT INTO voices (user_id, voice_id, name, chosen, created_at)"
              + " VALUES (1, 'v-mine-1', '我的声音', FALSE, CURRENT_TIMESTAMP)");
    }

    new SchemaUpgrades(dataSource).run(null);

    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement();
        ResultSet rows =
            statement.executeQuery("SELECT voice_id, name, chosen FROM voices ORDER BY voice_id")) {
      assertThat(rows.next()).isTrue();
      assertThat(rows.getString("voice_id")).isEqualTo("longjielidou_v3.6");
      assertThat(rows.getString("name")).as("空名字补成它自己的 id").isEqualTo("longjielidou_v3.6");
      assertThat(rows.getBoolean("chosen")).as("他选的那一个还是他选的那一个").isTrue();

      assertThat(rows.next()).isTrue();
      assertThat(rows.getString("name")).as("有名字的那一行一个字不动").isEqualTo("我的声音");
    }

    assertThatCode(() -> new SchemaUpgrades(dataSource).run(null)).doesNotThrowAnyException();
  }

  /**
   * 「有没有创作权」那一列（2026-10-18，四项开关收成一位）。
   *
   * <p>★ 这条判据挑的是**这一轮产品口径里最要紧的那个字面量**：
   * 老库补出来的值必须是 **1（有）**。老账号当初是"四个全关"，只因为那时候
   * 要站长一个个手工开；而这一轮定的是"注册即全开、站长只留收回那一下"，
   * 所以补列时的 `DEFAULT 1` 就是"**老账号自动给上**"这句话本身。
   *
   * <p>★ 它同时钉住三件事：列补上了、原来那行还在、**那一行的值是 1**。
   * 只验"列在不在"的话，一个 `ADD COLUMN allowed TINYINT NOT NULL`（没有默认值）
   * 或者补完顺手 `UPDATE ... SET allowed = 0` 的实现都能蒙过去——
   * 而它们的症状是"升级完所有人突然都没权限了"，看起来像权限系统坏了。
   */
  @Test
  @DisplayName("★ 老库补 allowed：老账号**自动给上**（值是 1），不是「补成没有」")
  void addingAllowedGrantsExistingAccounts() throws Exception {
    JdbcDataSource dataSource = legacyDatabase();
    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      // 一份"收成一位之前"的 user_permissions：四个 can_* 列，而且那个人四项全关
      statement.execute(
          "CREATE TABLE IF NOT EXISTS user_permissions ("
              + "user_id BIGINT NOT NULL,"
              + "can_text TINYINT NOT NULL DEFAULT 0,"
              + "can_image TINYINT NOT NULL DEFAULT 0,"
              + "can_vision TINYINT NOT NULL DEFAULT 0,"
              + "can_speech TINYINT NOT NULL DEFAULT 0,"
              + "updated_at DATETIME NOT NULL,"
              + "PRIMARY KEY (user_id))");
      statement.execute("DELETE FROM user_permissions");
      statement.execute(
          "INSERT INTO user_permissions (user_id, updated_at) VALUES (7, CURRENT_TIMESTAMP)");
    }

    new SchemaUpgrades(dataSource).run(null);

    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement();
        ResultSet rows = statement.executeQuery("SELECT allowed FROM user_permissions WHERE user_id = 7")) {
      assertThat(rows.next()).as("补列不该动到原有的行").isTrue();
      assertThat(rows.getBoolean("allowed")).as("老账号自动给上").isTrue();
    }

    // ★ 每次启动都会跑它，所以第二遍必须是干净的 no-op
    assertThatCode(() -> new SchemaUpgrades(dataSource).run(null)).doesNotThrowAnyException();
  }
}
