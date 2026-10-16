package com.onceuponme.api.health;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/health} —— 冒烟测试用的那一句。
 *
 * <p>★ 它**不需要** {@code X-Internal-Token}（见 {@code InternalTokenFilter}）：
 * 部署脚本与排障时要能不问任何凭证地确认"进程起来了、端口在听"。
 * 所以它回答的东西也刻意只有两件：服务名与当前时间——不报版本、不报数据库、
 * 不报任何配置。一个越权的健康检查是信息泄露最常见的起点。
 *
 * <p>★ 数据库连通性**不在这里探**：那会让这个端点从"你活着吗"变成
 * "整条链路都好吗"，而后者在故障时会把两个不同的问题混成同一个 500。
 * 数据库坏了，会在真正用到它的那个接口上以一条明确的错误出现。
 */
@RestController
public class HealthController {

  @GetMapping("/api/health")
  public Map<String, String> health() {
    return Map.of(
        "service", "xiaozhujue-api",
        "time", OffsetDateTime.now(ZoneId.of("Asia/Shanghai")).toString());
  }
}
