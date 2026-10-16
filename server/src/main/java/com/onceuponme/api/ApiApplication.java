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
@SpringBootApplication
@ConfigurationPropertiesScan
@MapperScan("com.onceuponme.api.auth.mapper")
public class ApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(ApiApplication.class, args);
  }
}
