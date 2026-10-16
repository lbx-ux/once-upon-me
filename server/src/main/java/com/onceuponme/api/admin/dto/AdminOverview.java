package com.onceuponme.api.admin.dto;

import java.util.List;

/**
 * 管理页要的全部东西。
 *
 * <p>★ 短信用量与用户表一起回，不另开一个接口：管理页上它们本来就是同一眼要看的
 * （"今天花了多少条"决定要不要把注册关掉），分两个请求只会让那一屏有两次闪烁，
 * 而且两次之间会短暂地自相矛盾（人数是新的、条数是旧的）。
 *
 * @param smsToday 今天（滚动 24 小时）发出去的验证码条数
 * @param smsDailyCap 全局每日硬顶（见 {@code AppProperties.Sms#globalDaily}）——
 *     与用量一起给，界面才能说"237 / 300"而不是一个孤零零的数
 * @param registrationOpen ★ 注册开关现在的状态。它**只读**，改它要动服务器上的配置文件：
 *     一个能改"钱从哪儿出"的开关不该是一个网页上的按钮（点错一次就是一堆陌生号码
 *     涌进来，而这一屏的主人可能正在别处）。界面上把它显示出来，是为了让人知道
 *     "现在陌生人可以注册"，而不是让人顺手点它。
 * @param demoAccount ★ 演示账号的名字（见 {@code DemoAccount}）。管理页要拿它把那一行
 *     标出来——**口令是公开的、四个能力全开**，而这一屏正是"谁在花我的钱"该被看见的地方。
 *     后端把名字给出去，而不是让前端自己写死一个 {@code "123456"}：那是两份真相，
 *     而漂了之后管理页会安静地不再提醒任何人。
 */
public record AdminOverview(
    List<AdminUserRow> users,
    long smsToday,
    int smsDailyCap,
    boolean registrationOpen,
    String demoAccount) {}
