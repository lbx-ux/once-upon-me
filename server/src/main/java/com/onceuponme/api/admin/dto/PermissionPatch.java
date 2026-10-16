package com.onceuponme.api.admin.dto;

import com.onceuponme.api.auth.Permissions;

/**
 * 改一个人的四个开关。★ 四件一起给（**全量**，不是"把某个打开"）：
 * 管理页上那一排 checkbox 提交的就是它现在整排的样子，而增量的写法
 * （{@code {field: "image", value: true}}）在并发下会变成"我以为我关掉的又开了"。
 * 全量是幂等的，重提交一次不会有第二种结果——与书架那次排序的取舍同一条理由。
 */
public record PermissionPatch(boolean text, boolean image, boolean vision, boolean speech) {

  public Permissions toPermissions() {
    return new Permissions(text, image, vision, speech);
  }
}
