package com.onceuponme.api.admin.dto;

/**
 * 开 / 关一个人的创作权限。★ **一位**（2026-10-18 由四个布尔收成一位）。
 *
 * <p>★ 仍然是<b>全量</b>而不是"把它打开"：管理页上那一格开关提交的就是它现在的位置，
 * 而增量的写法（{@code {op: "grant"}}）在并发下会变成"我以为我关掉的又开了"。
 * 全量是幂等的，重提交一次不会有第二种结果——与书架那次排序的取舍同一条理由。
 *
 * <p>★ 字段名与 {@code UserPermission.allowed}、与前端那个 {@code AdminUser.allowed}
 * 逐字一致：这一路上只有这一个词，中间任何一处换个名字，就多一次"哪个是哪个"的机会。
 */
public record PermissionPatch(boolean allowed) {}
