package com.onceuponme.api.auth;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 时间在两个世界之间换算的那一处。
 *
 * <p>★ 库里是 MySQL 的 DATETIME，**没有时区**；服务器在阿里云北京，时区是 Asia/Shanghai
 * （{@code application-prod.yml} 的 JDBC 串里也钉了它）。所以一个 DATETIME 的语义是
 * "北京时间的那一刻"，而这一点必须**在出参时补上**：
 * {@code 2026-10-16T20:00:00+08:00} 而不是 {@code 2026-10-16T20:00:00}。
 *
 * <p>★ 不补会怎样：前端拿 {@code new Date(...)} 解析——带时区的按那一刻算，
 * 不带的按**浏览器所在时区**算。同一条数据，在北京看是对的，在别的时区看就偏了几个小时。
 * 而这个仓库里要显示"首次登录时间"，正是那种一眼就能看出不对的字段。
 */
public final class Times {

  public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

  private Times() {}

  /** 现在（北京时间）。写库用这个，不要用 {@code LocalDateTime.now()}——那跟着机器时区走 */
  public static LocalDateTime now() {
    return LocalDateTime.now(ZONE);
  }

  /** 进 JSON 的形状：带 +08:00 的 ISO 8601。{@code null} 原样回 {@code null} */
  public static String iso(LocalDateTime at) {
    return at == null ? null : at.atZone(ZONE).toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
  }
}
