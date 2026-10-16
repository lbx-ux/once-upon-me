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
}
