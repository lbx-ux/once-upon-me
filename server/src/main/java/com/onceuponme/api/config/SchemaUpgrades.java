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
          new AddedColumn("users", "password_changed_at", "DATETIME NULL"),
          // 账号状态：ACTIVE / DISABLED。管理页的"停号"。见 AuthService#requireUser
          // ★ `NOT NULL DEFAULT 'ACTIVE'`：已经在库里的那些人一律是正常状态——
          //   补一列的意义正是"原来就有的都照旧"，而不是把他们一起停掉
          new AddedColumn("users", "status", "VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'"),
          // 「这个人有没有创作权」（2026-10-18，由四列收成一列）。
          // ★ `NOT NULL DEFAULT 1` 与上面那条 `DEFAULT 'ACTIVE'` 是同一条道理，
          //   而且这一条的字面意思就是产品那一句：**老账号自动给上**——
          //   他们当初是"四个全关"，只因为那时候要站长手工开。
          //   补出来的不是"没有权限"，而是"从今天起的默认权限"。
          new AddedColumn("user_permissions", "allowed", "TINYINT NOT NULL DEFAULT 1"));

  /**
   * 幂等的<b>数据修复</b>：把历史上写坏的值修回契约允许的那一种。
   *
   * <p>★ 它与上面那一列是同一件事的两半：上面加的是<b>列</b>，这里改的是<b>值</b>，
   * 而两者都是"一条后来才发现的不变式，在老库上不成立"。
   * 判断同样必须是幂等的（改完再跑一遍没有行受影响），所以它每次启动都跑。
   *
   * <p>★ 写进这里的那一条（2026-10-17）：{@code VoiceService#choose} 在调用方只给
   * {@code voiceId} 时，曾给预置音色落下一行<b>没有名字</b>的记录。
   * 那一行的症状不在写入那一刻，而在<b>读</b>的时候：前端的 `parseMyVoices`
   * 见到空名字会整份拒绝，于是整个「声音」那一屏说
   * 「服务端回的音色列表不是我们认识的形状」——一条坏记录，整页读不出来。
   * 写入口当天已经堵上（{@code VoiceService#labelOf}），这一条管的是<b>已经写坏的那些</b>：
   * 不修的话，那些账号的「声音」那一屏永远是坏的。退回 id 而不是删行——
   * 那行记着"这个人选过哪个音色"，删掉就把他的选择丢了。
   */
  private record DataFix(String table, String sql) {}

  private static final List<DataFix> DATA_FIXES =
      List.of(
          new DataFix(
              "voices",
              "UPDATE voices SET name = voice_id WHERE name IS NULL OR TRIM(name) = ''"));

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
        // ★ 表不在就**跳过**，而不是让它抛（与下面 `DATA_FIXES` 那条同一个形状）。
        //   表都不存在时，"它缺一列"没有对象：`schema.sql` 建出来的那张表本来就带着
        //   这一列，所以走到这个分支只可能是"这个库比那张表还老"。
        //   ★ 这一条不是假想的：`SchemaUpgradesTest` 里那份"老库"只有 users 一张表，
        //   2026-10-18 加 `user_permissions.allowed` 时它真的会炸在
        //   `Table "user_permissions" not found` 上。
        if (!tableExists(connection, column.table())) {
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

      for (DataFix fix : DATA_FIXES) {
        // ★ 表还不存在就**跳过**，而不是让它抛：那种库上不可能有坏值（一行都没有），
        //   所以这不是"静默放弃了一次修复"，是这条修复在这里没有对象。
        //   ★ 这一条不是假想的：`SchemaUpgradesTest` 里那份"老库"就只有 users 一张表，
        //   第一版无条件跑 UPDATE，结果是启动直接炸在一句 Table "voices" not found 上。
        if (!tableExists(connection, fix.table())) {
          continue;
        }
        int changed;
        try (Statement statement = connection.createStatement()) {
          changed = statement.executeUpdate(fix.sql());
        }
        // ★ 只在这一条**真的改到了行**的时候出声：每次启动都因为一条幂等语句
        //   打一行 warn，人就会开始忽略这一整片日志——而这正是"动过库"要显眼的原因
        if (changed > 0) {
          log.warn("修了一条历史坏值，影响 {} 行：{}", changed, fix.sql());
        }
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

  /** 这张表在不在。★ 与上面同一条理由：大小写交给驱动的 pattern 匹配会出"本地认得出、服务器认不出" */
  private static boolean tableExists(Connection connection, String table) throws SQLException {
    try (ResultSet tables =
        connection.getMetaData().getTables(connection.getCatalog(), null, null, null)) {
      while (tables.next()) {
        if (table.equalsIgnoreCase(tables.getString("TABLE_NAME"))) {
          return true;
        }
      }
    }
    return false;
  }
}
