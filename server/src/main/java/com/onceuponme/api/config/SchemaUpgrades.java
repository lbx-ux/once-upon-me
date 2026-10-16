package com.onceuponme.api.config;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

import javax.sql.DataSource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * 给**已经存在**的库补上后来才加的列。
 *
 * <p>★ 为什么需要它：`db/schema.sql` 里全是 {@code CREATE TABLE IF NOT EXISTS}，
 * 它管得住"表没建过"，管不住"表建过了、后来又加了一列"。
 * 而后者在本地会以这种样子出现（2026-10-17 实测）：
 *
 * <pre>
 *   Column "password_changed_at" not found
 *   → 启动失败，一屏 MyBatis 的栈
 * </pre>
 *
 * 当时那个本地 H2 文件库是加这一列**之前**建的，于是 `mvn spring-boot:run` 起不来了。
 * 服务器上的 MySQL 迟早会碰到同一件事（下一轮每加一列都会），而"部署时手工敲一条
 * ALTER"这种约定，在半年后没人记得的时候就是一次线上 500。
 *
 * <p>★ 它**不是**一个迁移框架，也刻意不做成"跑一个目录里的 SQL 文件"：
 * 那会立刻要面对版本表、顺序、回滚这一整套，而这一轮的库一共四张表。
 * 这里只是一个**列出来的清单**——下面每一条都是一次真实的、需要补的列。
 * 判断是幂等的（先问库"这列在不在"），所以每次启动都跑一遍没有代价。
 *
 * <p>★ 只在**缺**的时候 ALTER，绝不 DROP / MODIFY：这一轮的升级只有"加一列"这一种形状，
 * 而"启动时按代码重排你的库"是一个会吃掉数据的动作，不该顺手拥有。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SchemaUpgrades implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(SchemaUpgrades.class);

  /** 一条"后来才加的列"。★ 加新列时往这里加一行，同时在 `schema.sql` 的建表语句里也加上 */
  private record AddedColumn(String table, String column, String type) {}

  private static final List<AddedColumn> ADDED_COLUMNS =
      List.of(
          // 改密码用的"密码代次"。见 AuthService#requireUser
          new AddedColumn("users", "password_changed_at", "DATETIME NULL"));

  private final DataSource dataSource;

  public SchemaUpgrades(DataSource dataSource) {
    this.dataSource = dataSource;
  }

  @Override
  public void run(ApplicationArguments args) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
      for (AddedColumn column : ADDED_COLUMNS) {
        if (exists(connection, column)) {
          continue;
        }
        try (Statement statement = connection.createStatement()) {
          statement.execute(
              "ALTER TABLE "
                  + column.table()
                  + " ADD COLUMN "
                  + column.column()
                  + " "
                  + column.type());
        }
        // ★ 用 warn 而不是 info：这是一次**对库的写**，日志里必须看得见。
        //   出问题时第一件想知道的事就是"这次启动动过我的库没有"
        log.warn("给已有的表补了一列：{}.{}（这一列是后来加的，原来的库没有）", column.table(), column.column());
      }
    }
  }

  /**
   * 这列在不在。
   *
   * <p>★ 不用 {@code getColumns} 的那几个 pattern 参数去过滤，而是全扫一遍自己比：
   * 表名/列名的大小写在 H2（存成大写）与 MySQL（看 {@code lower_case_table_names}）
   * 之间不一样，把大小写交给驱动的 pattern 匹配，就成了"本地跑得通、服务器上认不出来"。
   * 这个方法的代价是一次元数据查询，而它每次启动只跑一次。
   */
  private static boolean exists(Connection connection, AddedColumn column) throws SQLException {
    try (ResultSet columns = connection.getMetaData().getColumns(connection.getCatalog(), null, null, null)) {
      while (columns.next()) {
        boolean sameTable = column.table().equalsIgnoreCase(columns.getString("TABLE_NAME"));
        boolean sameColumn = column.column().equalsIgnoreCase(columns.getString("COLUMN_NAME"));
        if (sameTable && sameColumn) {
          return true;
        }
      }
    }
    return false;
  }
}
