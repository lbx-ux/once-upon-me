package com.onceuponme.api.admin.dto;

import com.onceuponme.api.auth.PermissionRequest;
import com.onceuponme.api.auth.Permissions;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.auth.User;

/**
 * 管理页上的一条权限申请。
 *
 * <p>★ 为什么要带上**是谁**（`account` / `nickname` / `phone`）：用户的原话是
 * 「管理端也可以清楚的看到是谁发送的请求」——这正是邮件那条路最缺的东西。
 * 一封邮件只有一个发件地址，站长得自己去核对它是不是站上的人；
 * 这一行是从 `users` 表里查出来的那个账号本身。
 *
 * <p>★ `account` 与 `nickname` 分开给，**不在服务端拼成一句**：
 * 昵称可以是空的（那时界面上该显示打码手机号），而"空昵称怎么显示"这件事的判据
 * 已经在 `lib/auth/state.ts` 里写过一次了。服务端再拼一遍就是第二份实现。
 *
 * <p>★ 带着 {@code current}（这个人**现在**的四个开关）而不只是 {@code wants}：
 * 批准的含义是"**并上**他已有的权限，不是换成他要的"（见
 * {@code PermissionRequestService#decide}）。管理页上只显示"他要图像"是不够的——
 * 一个已经有文本权限的人申请图像，批完他会有两项，而只看"他要的那几项"的站长
 * 会以为自己刚把那个人的文本权限关掉了。两格并排放在一起，这次批准会改变什么
 * 才是一眼看得出来的。
 */
public record AdminRequestRow(
    String requestId,
    String userId,
    String account,
    String nickname,
    String phone,
    /** 他现在**手里有的**（不是这次申请的） */
    Permissions current,
    /** 这次**要的** */
    Permissions wants,
    String note,
    String status,
    String createdAt,
    String decidedAt) {

  public static AdminRequestRow of(PermissionRequest request, User user, Permissions current) {
    return new AdminRequestRow(
        String.valueOf(request.getId()),
        String.valueOf(request.getUserId()),
        user == null ? "" : user.getAccount(),
        user == null ? "" : user.getNickname(),
        user == null ? null : user.getPhone(),
        current,
        request.wants(),
        request.getNote(),
        request.getStatus(),
        Times.iso(request.getCreatedAt()),
        Times.iso(request.getDecidedAt()));
  }
}
