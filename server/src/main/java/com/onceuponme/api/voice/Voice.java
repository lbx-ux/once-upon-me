package com.onceuponme.api.voice;

import java.time.LocalDateTime;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/**
 * 一个音色记录：**这个人挑过/录过的嗓子**（工单 16，2026-10-17）。
 *
 * <p>★ 它替掉的是浏览器 localStorage 里那两个 key（{@code xiaozhujue.voice.v1} 与
 * {@code xiaozhujue.voices.v1}）。换掉的理由只有一条：**换台设备就没了**——
 * "我录的声音"这件事看起来像是账号的属性，而它当时住在一台设备的浏览器里。
 * 用户 2026-10-17 定的口径是「音色一并挂到账号上」。
 *
 * <p>★ <b>表里一个字节的音频都没有，这不是漏了。</b> 样本从不上传到我们这边以外的
 * 任何地方（§8.3 要求"拿到 voice_id 后立即删"，我们的实现更强：样本除了上传那一次，
 * 不进磁盘、不进库、不进日志）。这里只有厂商回的 {@code voiceId}、
 * 当时的 {@code model}、用户起的名字与时间。
 *
 * <p>★ {@code model} 不是记账，是**判据**：克隆音色绑死在创建它时的 TTS 模型上
 * （实测跨模型 400 {@code [411]}），所以当前模型与它对不上时那张卡不许选
 * （前端 `lib/voices/catalog.ts` 用这一列做那个判断）。
 *
 * <p>★ 为什么字段叫 {@code chosen} 而不是 {@code current}：{@code current} 是 MySQL
 * 的保留字，而这一列会被拼进 SQL；改名比加反引号便宜，也不会有人下次忘了加。
 */
@TableName("voices")
public class Voice {

  /** 厂商侧标识符的形状。★ 它会被拼进 DELETE 的 URL、也会进 TTS 请求，所以要挡一道 */
  private static final String ID_PATTERN = "^[A-Za-z0-9._:-]{1,128}$";

  /** 名字上限。★ 与 `schema.sql` 的 `VARCHAR(64)` 同值，改要一起改 */
  public static final int NAME_MAX = 64;
  /** 模型名上限。★ 与 `schema.sql` 的 `VARCHAR(128)` 同值 */
  public static final int MODEL_MAX = 128;

  @TableId(type = IdType.AUTO)
  private Long id;

  private Long userId;

  /** 厂商回的 voice_id（预置音色就是那两个固定 id） */
  private String voiceId;

  /** 用户起的名字。★ 预置音色给的是控制台里那个名字（豆豆 / 灵灵） */
  private String name;

  /** 创建它时的 TTS 模型。★ 判据，不是记账——见类注释 */
  private String model;

  /** 是不是"下次做书用这一个"。★ 一个人最多一条为真（由 service 保证，不是靠约束） */
  private boolean chosen;

  private LocalDateTime createdAt;

  /** 这个 id 的形状能不能收。★ 空串**不算合法**（要清空请走"不选"那条路） */
  public static boolean validVoiceId(String voiceId) {
    return voiceId != null && voiceId.matches(ID_PATTERN);
  }

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getUserId() {
    return userId;
  }

  public void setUserId(Long userId) {
    this.userId = userId;
  }

  public String getVoiceId() {
    return voiceId;
  }

  public void setVoiceId(String voiceId) {
    this.voiceId = voiceId;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getModel() {
    return model;
  }

  public void setModel(String model) {
    this.model = model;
  }

  public boolean isChosen() {
    return chosen;
  }

  public void setChosen(boolean chosen) {
    this.chosen = chosen;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }
}
