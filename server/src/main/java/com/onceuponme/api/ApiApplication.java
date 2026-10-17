package com.onceuponme.api;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * 小主角 · 账号与权限后端。
 *
 * <p>★ 它只管「你是谁」与「你能用什么」（{@code README.md} §二 的分工表）。
 * 模型密钥、引擎、作品文件**都不在这里**——那是 Next 那一侧的事，
 * 所以这个进程挂掉时，已登录的人看不了新书，但没有任何作品会因此损坏。
 */
/**
 * ★ 扫描包是**列出来的**，不是一个 `com.onceuponme.api.**` 的通配：
 *   加了 `@MapperScan` 之后，MyBatis 那个"自动扫 @Mapper"的兜底就不跑了
 *   （starter 只在没有 `@MapperScan` 时才自动扫），所以每加一个 mapper 包
 *   都要在这里加一行——**这是刻意的**：漏掉那一行的症状是启动期一句
 *   "No qualifying bean of type ...Mapper"，而不是某个接口悄悄少了一半能力。
 *   （2026-10-17 工单 16 加 `voice.mapper` 时正好踩过一次：先只放 `@Mapper`
 *   在接口上，测试那一栏报的是 ApplicationContext 加载失败。）
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@MapperScan({"com.onceuponme.api.auth.mapper", "com.onceuponme.api.voice.mapper"})
public class ApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(ApiApplication.class, args);
  }
}
