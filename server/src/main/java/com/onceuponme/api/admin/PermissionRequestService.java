package com.onceuponme.api.admin;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.admin.dto.AdminRequestRow;
import com.onceuponme.api.auth.PermissionRequest;
import com.onceuponme.api.auth.Permissions;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;
import com.onceuponme.api.auth.UserPermission;
import com.onceuponme.api.auth.mapper.PermissionRequestMapper;
import com.onceuponme.api.auth.mapper.UserMapper;
import com.onceuponme.api.auth.mapper.UserPermissionMapper;
import com.onceuponme.api.support.ApiException;

/**
 * 权限申请：用户提、管理员批（用户 2026-10-17 要的，替掉原来那个邮箱）。
 *
 * <p>三个决定写在类上，因为它们是这一个功能真正的形状：
 *
 * <p>1. <b>一个人同时只有一条待处理的申请。</b>再提一次是**改那一条**，不是又插一条。
 * 不这么做的话，一个人点三下就有三条一样的申请挂在站长的列表里，
 * 而站长没法判断那是"三个人要"还是"一个人点了三次"——列表本身失去了信息量。
 *
 * <p>2. <b>批准是"并上"不是"换成"。</b>见 {@link #decide}：这个人可能已经有文本权限，
 * 而这次只申请了图像。写成赋值的话，批准一次图像会把他的文本权限**关掉**——
 * 一个看起来像"权限会自己丢"的 bug，而它只在"申请人已经有一半权限"时才出现。
 *
 * <p>3. <b>拒掉的那条留着。</b>它是"申请过、被拒了"的唯一记录。不留在库里，
 * 申请人会反复提同一件事，站长会反复拒同一件事，而两边都以为对方忘了。
 */
@Service
public class PermissionRequestService {

  private final PermissionRequestMapper requests;
  private final UserMapper users;
  private final UserPermissionMapper permissions;

  public PermissionRequestService(
      PermissionRequestMapper requests, UserMapper users, UserPermissionMapper permissions) {
    this.requests = requests;
    this.users = users;
    this.permissions = permissions;
  }

  /**
   * 提一条申请（用户自己）。
   *
   * <p>★ 已经有一条待处理时**改那一条**并把时间刷新：这条申请代表的是"我现在想要什么"，
   * 而"半分钟前我也想要同样的东西"对站长没有价值。
   *
   * <p>★ <b>申请一律是"四项一起开通"</b>（用户 2026-10-17 的原话：「申请的时候这些功能
   * 是一起发放的，申请的时候申请一下就行了」）。在那之前界面上是四个复选框，让申请人自己勾，
   * 但那个选择是**假的**：站长的实际做法就是一起给，而一个"勾了视觉却没批视觉"的界面，
   * 只会让申请人以为自己哪里填错了。现在不问了——申请表里也再没有 `wants` 这个概念。
   * 库里那四列留着（一律写真），记的是"这一条申请要开什么"，
   * 这样下游不必去猜"没有 wants 是什么意思"。
   */
  @Transactional
  public void submit(long userId, String note) {
    Permissions wants = Permissions.all();
    String text = note == null ? "" : note.trim();
    if (text.length() > PermissionRequest.NOTE_MAX) {
      throw ApiException.badRequest(
          "note-too-long", "说明最多 " + PermissionRequest.NOTE_MAX + " 个字");
    }

    PermissionRequest existing =
        requests.selectOne(
            Wrappers.<PermissionRequest>lambdaQuery()
                .eq(PermissionRequest::getUserId, userId)
                .eq(PermissionRequest::getStatus, PermissionRequest.PENDING)
                .orderByDesc(PermissionRequest::getCreatedAt)
                .last("LIMIT 1"));

    PermissionRequest row = existing == null ? new PermissionRequest() : existing;
    row.setUserId(userId);
    row.setWantsText(wants.text());
    row.setWantsImage(wants.image());
    row.setWantsVision(wants.vision());
    row.setWantsSpeech(wants.speech());
    row.setNote(text.isEmpty() ? null : text);
    row.setStatus(PermissionRequest.PENDING);
    // ★ re-submit 时把"谁批的"清掉：这一条现在是新的待处理，不该带着上一次的决定
    row.setDecidedAt(null);
    row.setDecidedBy(null);
    row.setCreatedAt(Times.now());

    if (existing == null) {
      requests.insert(row);
    } else {
      requests.updateById(row);
    }
  }

  /**
   * 这个人现在待处理的那一条（界面上要显示"你已经申请过了"）。没有就是 `null`。
   *
   * <p>★ 它把**申请人自己**与**他现有的四个开关**都查出来（`AdminRequestRow.of(request, user, current)`），
   * 而不是像第一版那样传 `null` 进去。传 `null` 会让响应里的 `account` 变成空串，
   * 而"这一行是谁的"正是这一整个功能要回答的那件事——用户那一半看一眼自己的账号，
   * 与管理员那一半看到的是**同一行同一个形状**，两个屏幕就不该长出两种记录。
   * 代价是一次按主键的查询。
   */
  public AdminRequestRow minePending(long userId) {
    PermissionRequest mine =
        requests.selectOne(
            Wrappers.<PermissionRequest>lambdaQuery()
                .eq(PermissionRequest::getUserId, userId)
                .eq(PermissionRequest::getStatus, PermissionRequest.PENDING)
                .orderByDesc(PermissionRequest::getCreatedAt)
                .last("LIMIT 1"));
    return mine == null ? null : AdminRequestRow.of(mine, users.selectById(userId), permissionsOf(userId));
  }

  /**
   * 全部申请，**待处理在前、新的在前**。
   *
   * <p>★ 已处理的也一起给：管理页要能回答"这个人上次申请是什么时候、批了没有"，
   * 而那件事只看待处理列表是答不出来的（他上次被拒之后就不在列表里了）。
   */
  public List<AdminRequestRow> list() {
    List<PermissionRequest> all =
        requests.selectList(
            Wrappers.<PermissionRequest>lambdaQuery()
                .orderByAsc(PermissionRequest::getStatus)
                .orderByDesc(PermissionRequest::getCreatedAt));
    if (all.isEmpty()) {
      return List.of();
    }

    List<Long> userIds = all.stream().map(PermissionRequest::getUserId).distinct().toList();
    Map<Long, User> byId =
        users.selectList(Wrappers.<User>lambdaQuery().in(User::getId, userIds)).stream()
            .collect(Collectors.toMap(User::getId, Function.identity(), (a, b) -> a));
    // ★ 现有的四个开关也**一次查完**，与用户表同一个做法：这一列有几十行时，
    //   逐行查一次是几十次往返，而它们在同一个请求里、彼此没有依赖
    Map<Long, UserPermission> currentById =
        permissions.selectList(Wrappers.<UserPermission>lambdaQuery().in(UserPermission::getUserId, userIds))
            .stream()
            .collect(Collectors.toMap(UserPermission::getUserId, Function.identity(), (a, b) -> a));

    List<AdminRequestRow> rows = new ArrayList<>(all.size());
    for (PermissionRequest request : all) {
      UserPermission current = currentById.get(request.getUserId());
      rows.add(
          AdminRequestRow.of(
              request,
              byId.get(request.getUserId()),
              current == null ? Permissions.none() : current.toPermissions()));
    }
    return rows;
  }

  /**
   * 批 / 拒。
   *
   * <p>★ **批准是"并上"不是"换成"**（类注释第 2 条）：先把这个人现有的四个开关读出来，
   * 与申请要的那几个取**或**，再整体写回。直接拿申请的那四列去覆盖的话，
   * 一个已经有几项权限的人会被批准成"只有申请里那几项"——而他什么都没做错。
   * ★ 从那以后申请恒为**四项全开**（见 {@link #submit}），所以这一条现在等价于
   * "开全部"。合并的写法**留着不动**：它比"直接赋 true"更准确地说出了这件事的意思，
   * 而且哪天申请又能分项了，这里不用改。
   *
   * <p>★ 只有待处理的那一条能动。重复点两次通过（列表没刷新、或者两个管理员同时在看）
   * 会走成第二次 400，而不是"又并了一遍"——后者本身无害，但它会让"这次动作到底做了什么"
   * 变成一个说不清的问题。
   */
  @Transactional
  public AdminRequestRow decide(long requestId, boolean approve, long adminId) {
    PermissionRequest request = requests.selectById(requestId);
    if (request == null) {
      throw ApiException.notFound("request-not-found", "找不到这条申请");
    }
    if (!request.isPending()) {
      throw ApiException.badRequest("already-decided", "这条申请已经处理过了");
    }

    if (approve) {
      UserPermission row = permissions.selectById(request.getUserId());
      Permissions before = row == null ? Permissions.none() : row.toPermissions();
      Permissions wants = request.wants();
      Permissions merged =
          new Permissions(
              before.text() || wants.text(),
              before.image() || wants.image(),
              before.vision() || wants.vision(),
              before.speech() || wants.speech());

      if (row == null) {
        row = UserPermission.noneFor(request.getUserId(), Times.now());
      }
      row.setCanText(merged.text());
      row.setCanImage(merged.image());
      row.setCanVision(merged.vision());
      row.setCanSpeech(merged.speech());
      row.setUpdatedAt(Times.now());
      if (permissions.selectById(request.getUserId()) == null) {
        permissions.insert(row);
      } else {
        permissions.updateById(row);
      }
    }

    request.setStatus(approve ? PermissionRequest.APPROVED : PermissionRequest.REJECTED);
    request.setDecidedAt(Times.now());
    request.setDecidedBy(adminId);
    requests.updateById(request);

    return AdminRequestRow.of(
        request, users.selectById(request.getUserId()), permissionsOf(request.getUserId()));
  }

  /**
   * 一个人现在手里有的四个开关。
   *
   * <p>★ **缺权限行 = 四个全关**，不是"没有数据"：这是这个项目的口径（新用户零权限），
   * 与 {@code AdminService#overview} 里那一句是同一条。少了它，管理页上那一格
   * 会显示成空白，而"他什么都没有"与"我读不出来"是两件完全不同的事——
   * 前者决定这次批准是从零开始，后者该让站长先去查一查。
   */
  private Permissions permissionsOf(long userId) {
    UserPermission row = permissions.selectById(userId);
    return row == null ? Permissions.none() : row.toPermissions();
  }
}
