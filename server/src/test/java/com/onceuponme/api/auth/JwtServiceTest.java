package com.onceuponme.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDateTime;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

/**
 * 两种票的边界。★ 这里最要紧的一条是**作用域不能串**：
 * 拿"设密码那张票"当会话用，等于"还没设密码就登进来了"——
 * 那不是一个小 bug，那是这一轮唯一一处不设防的门。
 */
class JwtServiceTest {

  private static final String SECRET = "unit-test-secret-at-least-32-bytes-long!";

  private final JwtService jwt = new JwtService(properties(SECRET));

  private static AppProperties properties(String secret) {
    return new AppProperties(
        new AppProperties.Jwt(secret, 168, 5),
        "",
        new AppProperties.Admin("", ""),
        new AppProperties.Sms(false, "", "", "", "", 60, 3, 10, 5, 20, 300, true));
  }

  private static User user(long id, String account, String role) {
    User user = new User();
    user.setId(id);
    user.setAccount(account);
    user.setRole(role);
    user.setNickname("");
    user.setAvatar("");
    user.setCreatedAt(LocalDateTime.now());
    return user;
  }

  @Test
  @DisplayName("会话票能验回来，并且带着谁、什么角色")
  void sessionRoundTrip() {
    String token = jwt.signSession(user(7L, "13800138000", "ADMIN"));

    JwtService.Session session = jwt.verifySession(token);

    assertThat(session.userId()).isEqualTo(7L);
    assertThat(session.account()).isEqualTo("13800138000");
    assertThat(session.role()).isEqualTo("ADMIN");
  }

  @Test
  @DisplayName("★ 设密码那张票不能当会话用")
  void ticketIsNotASession() {
    String ticket = jwt.signTicket("13800138000");

    assertThatThrownBy(() -> jwt.verifySession(ticket))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("完成登录");
  }

  @Test
  @DisplayName("★ 会话票也不能拿去设密码")
  void sessionIsNotATicket() {
    String token = jwt.signSession(user(7L, "13800138000", "USER"));

    assertThatThrownBy(() -> jwt.verifyTicket(token))
        .isInstanceOf(ApiException.class)
        .hasMessageContaining("验证码");
  }

  @Test
  @DisplayName("票里写的是哪个号，设密码就只能给那个号设")
  void ticketCarriesTheAccount() {
    assertThat(jwt.verifyTicket(jwt.signTicket("13800138000"))).isEqualTo("13800138000");
  }

  @Test
  @DisplayName("换个密钥签的票验不过（签名是真的在验，不是只看格式）")
  void rejectsForeignSignature() {
    SecretKey otherKey = Keys.hmacShaKeyFor("another-secret-at-least-32-bytes-long!!!!".getBytes(StandardCharsets.UTF_8));
    String forged =
        Jwts.builder()
            .subject("7")
            .claim("acc", "13800138000")
            .claim("role", "ADMIN")
            .claim("scope", "session")
            .signWith(otherKey)
            .compact();

    assertThatThrownBy(() -> jwt.verifySession(forged)).isInstanceOf(ApiException.class);
  }

  @Test
  @DisplayName("随机乱串一律 401，而且不把内部原因说出来")
  void rejectsGarbage() {
    assertThatThrownBy(() -> jwt.verifySession("not-a-token"))
        .isInstanceOf(ApiException.class)
        .hasMessage("登录已过期，请重新登录");
  }

  @Test
  @DisplayName("没配密钥时（本地那一档）自己生成一把，照样能签能验")
  void worksWithoutConfiguredSecret() {
    JwtService random = new JwtService(properties(""));

    JwtService.Session session = random.verifySession(random.signSession(user(1L, "123456", "USER")));

    assertThat(session.account()).isEqualTo("123456");
  }
}
