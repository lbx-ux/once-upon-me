package com.onceuponme.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 登录名、口令、头像 id 的形状。几条边界都是这一轮真正会被撞到的。 */
class AccountRulesTest {

  @ParameterizedTest
  @ValueSource(strings = {"13800138000", "19912345678"})
  @DisplayName("11 位、1 开头 = 手机号（能收短信）")
  void recognisesPhones(String account) {
    assertThat(AccountRules.isPhone(account)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"123456", "100000", "1234567890"})
  @DisplayName("6–11 位数字但不是手机号 = 短账号（只能密码登录）")
  void recognisesShortAccounts(String account) {
    assertThat(AccountRules.isPhone(account)).isFalse();
    assertThatCode(() -> AccountRules.requireAccount(account)).doesNotThrowAnyException();
  }

  @ParameterizedTest
  @ValueSource(strings = {"12345", "admin", "138001380001", "138 0013 8000", ""})
  @DisplayName("其它一律不合法：太短、字母、超长、带空格、空串")
  void rejectsEverythingElse(String account) {
    assertThatThrownBy(() -> AccountRules.requireAccount(account))
        .hasMessageContaining("11 位手机号");
  }

  @Test
  @DisplayName("口令下限 8 位——只管自己设密码那一步（登录不查它）")
  void passwordFloor() {
    assertThatThrownBy(() -> AccountRules.requirePassword("1234567")).hasMessageContaining("至少 8 位");
    assertThatCode(() -> AccountRules.requirePassword("12345678")).doesNotThrowAnyException();
  }

  @Test
  @DisplayName("验证码必须是 6 位数字")
  void codeShape() {
    assertThatCode(() -> AccountRules.requireCode("123456")).doesNotThrowAnyException();
    assertThatThrownBy(() -> AccountRules.requireCode("12345")).hasMessageContaining("6 位");
    assertThatThrownBy(() -> AccountRules.requireCode("abc123")).hasMessageContaining("6 位");
  }

  @Test
  @DisplayName("★ 头像只收一个 id 的形状：路径穿越与外部 URL 都进不来")
  void avatarIdOnly() {
    assertThatCode(() -> AccountRules.requireAvatarId("fox")).doesNotThrowAnyException();
    assertThatCode(() -> AccountRules.requireAvatarId("star-2")).doesNotThrowAnyException();

    assertThatThrownBy(() -> AccountRules.requireAvatarId("../../etc/passwd")).isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> AccountRules.requireAvatarId("https://evil.example/x.png")).isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> AccountRules.requireAvatarId("")).isInstanceOf(RuntimeException.class);
  }

  @Test
  @DisplayName("演示账号 123456 说的就是那个号，而它不是一个手机号")
  void demoAccountShape() {
    assertThat(AccountRules.isPhone(DemoAccount.ACCOUNT)).isFalse();
    assertThatCode(() -> AccountRules.requireAccount(DemoAccount.ACCOUNT)).doesNotThrowAnyException();
  }
}
