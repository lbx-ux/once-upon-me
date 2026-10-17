package com.onceuponme.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * `db/schema.sql` 里**不许出现只有一家认的写法**。
 *
 * <p>★ 这一条是被一次真实事故逼出来的（2026-10-17，工单 03 上服务器的第一晚）：
 * 工单 09 往那个文件的末尾加了一句 `CREATE INDEX IF NOT EXISTS ...`——
 * 文件头本来就写着"MySQL 8 不支持它"，而**本地一直没问题**（我们本机跑的是 H2，
 * H2 认这一句）。上到 MySQL 的那一刻 `spring.sql.init` 挂在那句上，
 * **整个后端起不来**，日志里只有一句 `You have an error in your SQL syntax`。
 *
 * <p>★ 为什么用一个测字符串的测试，而不是"跑一遍 MySQL 试试"：
 * 这一档没有 MySQL 可用（本机与 CI 都没有），而"跑不起来"这件事
 * **要到部署那天才出现**——那正是最坏的出现时间。这条测试不验语义，
 * 它只把文件头那几条纪律变成**会红的判据**：
 * 这一份 DDL 要同时喂给 H2（本地）与 MySQL 8（服务器），所以它只能用两家都认的那一小块。
 *
 * <p>★ 它测不出"未来的某个新写法只有一家认"（那要一张兼容性矩阵）。
 * 它管得住的是**已经踩过的那几个**——而"同一个坑踩第二次"才是真正会发生的事。
 */
class SchemaSqlPortabilityTest {

  private static final String NL = String.valueOf((char) 10);

  /**
   * **语句**部分（注释已剥掉）。
   *
   * <p>★ 从 classpath 读，与 `spring.sql.init` 读的**是同一个文件**（不是仓库里另一份副本）。
   *
   * <p>★ 剥注释这一步不能省，而且它是我第一版写错的地方：那个文件头**用文字解释**
   * "没有 `CREATE INDEX IF NOT EXISTS`"——不剥注释的话，判据命中的是**解释这句禁止**
   * 的那句注释，于是这条测试在文件完全正确时也红。测 SQL 就得测 SQL。
   * （这个文件里只有 `--` 行注释，没有块注释；真加了块注释要一起处理。）
   */
  private static String statementsOf() throws IOException {
    String raw;
    try (InputStream in = SchemaSqlPortabilityTest.class.getResourceAsStream("/db/schema.sql")) {
      assertThat(in).as("classpath 上找不到 db/schema.sql").isNotNull();
      raw = new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }

    StringBuilder statements = new StringBuilder();
    for (String line : raw.split("\\r?\\n")) {
      int comment = line.indexOf("--");
      statements.append(comment >= 0 ? line.substring(0, comment) : line).append(NL);
    }
    return statements.toString();
  }

  @Test
  @DisplayName("★ 没有 `CREATE INDEX IF NOT EXISTS`（MySQL 8 不认，实测整个后端起不来）")
  void noCreateIndexIfNotExists() throws IOException {
    String sql = statementsOf();

    // ★ 先钉住"索引这件事我们确实做了"——否则把索引整条删掉也能让这条测试变绿，
    //   而那会让 permission_requests 的列表每次都全表排序
    assertThat(sql).contains("KEY idx_permission_requests_status");
    assertThat(sql).as("次级索引一律写成建表语句里的 KEY 名字 (列)").doesNotContain("CREATE INDEX");
  }

  @Test
  @DisplayName("没有 MySQL 专有的表选项 / 反引号（H2 那一档会原地跑不起来）")
  void noMysqlOnlySyntax() throws IOException {
    String sql = statementsOf();
    for (String forbidden : List.of("ENGINE=", "DEFAULT CHARSET", "`")) {
      assertThat(sql).as("%s 只有 MySQL 认", forbidden).doesNotContain(forbidden);
    }
  }
}
