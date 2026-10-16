package com.onceuponme.api.admin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.admin.dto.AdminOverview;
import com.onceuponme.api.admin.dto.AdminUserRow;
import com.onceuponme.api.auth.AuthService;
import com.onceuponme.api.auth.DemoAccount;
import com.onceuponme.api.auth.Permissions;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;
import com.onceuponme.api.auth.UserPermission;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.auth.mapper.UserPermissionMapper;
import com.onceuponme.api.auth.sms.SmsRateLimiter;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

/**
 * 管理页那两件事：列出所有人、改一个人的四个开关。
 *
 * <p>★ 两个不显然的地方：
 *
 * <p>1. <b>用户与权限分两次查，再在内存里拼</b>，而不是写一句 JOIN。
 * 用户数是"几个人"，权限表是"几行"——几百行的规模下，两次查询与一次 JOIN
 * 的差别量不出来，而 JOIN 之后要自己把结果映射成一个复合对象，
 * 那正是 MyBatis 最容易写错、也最难看出来的一处。真正该换的时机是
 * "这一屏开始分页"。
 *
 * <p>2. <b>缺权限行的人按"四个全关"显示</b>（{@link Permissions#none()}），
 * 而不是显示成"没有权限数据"。前者是这个项目的口径（新用户零权限），
 * 后者会让管理页上出现一行看不懂的空格子。<b>保存时会补上这一行</b>，
 * 所以"缺行"只会出现在"这个号是更早的版本建的"这种情况下。
 */
@Service
public class AdminService {

  private final UserMapper users;
  private final UserPermissionMapper permissions;
  private final SmsRateLimiter rateLimiter;
  private final AuthService auth;
  private final AppProperties properties;

  public AdminService(
      UserMapper users,
      UserPermissionMapper permissions,
      SmsRateLimiter rateLimiter,
      AuthService auth,
      AppProperties properties) {
    this.users = users;
    this.permissions = permissions;
    this.rateLimiter = rateLimiter;
    this.auth = auth;
    this.properties = properties;
  }

  public AdminOverview overview() {
    List<User> all =
        users.selectList(Wrappers.<User>lambdaQuery().orderByDesc(User::getCreatedAt));
    Map<Long, UserPermission> byUser =
        permissions.selectList(null).stream()
            .collect(Collectors.toMap(UserPermission::getUserId, Function.identity(), (a, b) -> a));

    List<AdminUserRow> rows = new ArrayList<>(all.size());
    for (User user : all) {
      UserPermission row = byUser.get(user.getId());
      rows.add(
          AdminUserRow.of(user, row == null ? Permissions.none() : row.toPermissions()));
    }

    AppProperties.Sms sms = properties.sms();
    return new AdminOverview(
        rows,
        rateLimiter.todayCount(),
        sms == null ? 0 : sms.globalDaily(),
        auth.registrationOpen(),
        DemoAccount.ACCOUNT);
  }

  /**
   * 改一个人的四个开关。★ 全量替换（见 {@code PermissionPatch} 上那段），
   * 并且**立刻**在返回里带上这个人现在的样子：管理页把那四个 checkbox 重绘成
   * 服务端说的那一份，而不是继续显示本地那一份——否则一次失败（比如网络断了）
   * 会让界面看起来"改成功了"。
   */
  @Transactional
  public AdminUserRow updatePermissions(long userId, Permissions next) {
    User user = users.selectById(userId);
    if (user == null) {
      throw ApiException.notFound("user-not-found", "找不到这个账号");
    }

    UserPermission row = permissions.selectById(userId);
    if (row == null) {
      row = UserPermission.noneFor(userId, Times.now());
    }
    row.setCanText(next.text());
    row.setCanImage(next.image());
    row.setCanVision(next.vision());
    row.setCanSpeech(next.speech());
    row.setUpdatedAt(Times.now());

    if (permissions.selectById(userId) == null) {
      permissions.insert(row);
    } else {
      permissions.updateById(row);
    }
    return AdminUserRow.of(user, row.toPermissions());
  }
}
