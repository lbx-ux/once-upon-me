package com.onceuponme.api.voice;

import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.onceuponme.api.auth.Times;
import com.onceuponme.api.support.ApiException;
import com.onceuponme.api.voice.mapper.VoiceMapper;

/**
 * 音色：挑一个、记一条、删一条（工单 16，2026-10-17）。
 *
 * <p>三条决定，每条都对应一个具体的失败：
 *
 * <p>1. <b>"挑了哪一个"与"我录过哪些"是同一张表的两件事</b>，靠 {@code chosen} 那一列分。
 * 分两张表（一张"我的音色"、一张"当前选择"）会多一套"两张表之间对不上"的可能，
 * 而它们要回答的问题本来就是同一个："这个人现在有哪些嗓子、在用哪一个"。
 *
 * <p>2. <b>一个人最多一条 {@code chosen}。</b> 换一个的时候在同一个事务里把其余的
 * 一律置假（{@link #choose}）。不这么做的话会出现"两条都说是当前"，
 * 而那时候"用哪一个"就变成了一个看查询顺序的答案——症状是"同一本书，
 * 两次生成用了两个声音"。
 *
 * <p>3. ★ <b>删掉当前那个时，"当前"变成空，不回落。</b> 回落会让"我删掉的那个声音"
 * 悄悄变成另一个陌生声音，而用户只是不想要那一条。空着之后界面上那句
 * 「还没挑音色」是**对的**，而且它告诉用户下一步做什么（`narrationBlockOf`）。
 */
@Service
public class VoiceService {

  private final VoiceMapper voices;

  public VoiceService(VoiceMapper voices) {
    this.voices = voices;
  }

  /** 这个人的全部音色，新的在前（与书架同一个方向：最近用的在最上面） */
  public List<Voice> mine(long userId) {
    return voices.selectList(
        Wrappers.<Voice>lambdaQuery()
            .eq(Voice::getUserId, userId)
            .orderByDesc(Voice::getCreatedAt)
            .orderByDesc(Voice::getId));
  }

  /** 现在选的那个 id。没挑过就是**空串**（不是 null）：前端那一格是一个字符串 */
  public String chosenId(long userId) {
    for (Voice voice : mine(userId)) {
      if (voice.isChosen()) return voice.getVoiceId();
    }
    return "";
  }

  /**
   * 选一个。
   *
   * <p>★ {@code voiceId} 为空 = **取消选择**（把 {@code chosen} 清掉，条目留着）。
   * 这与"删掉那一条"是两件事：删掉是"这个嗓子我不再要了"，取消是"这次先不指定"。
   * 合成一条的话，用户想"先不选"就只能把录好的声音一起删掉。
   *
   * <p>★ 选一个**库里还没有**的 id 会顺手把它记下来（预置音色就是这样进来的：
   * 豆豆 / 灵灵两条是代码里的常量，第一次被选中时才落一行）。不这么做的话
   * "当前音色"要么没法表达，要么只能给每个用户预填两行——而预填的那两行
   * 会在厂商改音色库时变成两条指向不存在声音的记录。
   */
  @Transactional
  public void choose(long userId, String voiceId, String name, String model) {
    clearChosen(userId);
    String id = trim(voiceId);
    if (id.isEmpty()) return;
    requireValidId(id);

    Voice row = find(userId, id);
    if (row == null) {
      row = new Voice();
      row.setUserId(userId);
      row.setVoiceId(id);
      row.setName(trim(name));
      row.setModel(trim(model));
      row.setCreatedAt(Times.now());
      row.setChosen(true);
      voices.insert(row);
      return;
    }
    row.setChosen(true);
    // ★ 名字与模型只在调用方**给了**的时候才覆盖：界面在只切一次选择时
    //   未必知道模型（它只在语音那一屏读过），空值覆盖会把判据那一列擦掉，
    //   而擦掉之后那张卡的"模型对不上"判断就永远是"对得上"
    if (!trim(name).isEmpty()) row.setName(trim(name));
    if (!trim(model).isEmpty()) row.setModel(trim(model));
    voices.updateById(row);
  }

  /**
   * 记一条（刚克隆出来的那条），并设为当前。
   *
   * <p>★ 与 {@link #choose} 分开：这一条的语义是"多了一个嗓子"，
   * 所以它**必须**带名字与模型（否则那张卡在界面上没有名字、
   * 也没法判"模型还对得上吗"）。两个动作合成一个函数的话，
   * 调用方迟早会用"只切选择"的参数去建一条记录，而建出来的是一条空卡。
   */
  @Transactional
  public Voice remember(long userId, String voiceId, String name, String model) {
    String id = trim(voiceId);
    requireValidId(id);
    String label = trim(name);
    if (label.isEmpty()) {
      throw ApiException.badRequest("invalid-request", "音色要有一个名字（默认叫「我的声音」）");
    }
    if (label.length() > Voice.NAME_MAX) {
      throw ApiException.badRequest("invalid-request", "音色名字最多 " + Voice.NAME_MAX + " 个字");
    }
    String modelId = trim(model);
    if (modelId.length() > Voice.MODEL_MAX) {
      throw ApiException.badRequest("invalid-request", "模型名太长了");
    }

    Voice row = find(userId, id);
    if (row == null) {
      row = new Voice();
      row.setUserId(userId);
      row.setVoiceId(id);
      row.setCreatedAt(Times.now());
    }
    row.setName(label);
    row.setModel(modelId);
    // ★ 刚录完就想着用它（与前端原来的 `rememberVoice` 同一个语义）
    clearChosen(userId);
    row.setChosen(true);
    if (row.getId() == null) voices.insert(row);
    else voices.updateById(row);
    return row;
  }

  /**
   * 删掉一条。
   *
   * <p>★ 找不到就**什么都不做**（不报 404）：连点两下、或者两个标签页各删一次，
   * 第二下得到的"删除失败"是假话——它已经是没了。
   * 这与 `deletePrefix` 对不存在的路径回 0 是同一条口径。
   */
  @Transactional
  public void forget(long userId, String voiceId) {
    String id = trim(voiceId);
    if (id.isEmpty()) return;
    // ★ 不用 `deleteById`：那一个只按主键删，而**别人的那一行**的主键一样打得进来。
    //   条件里带上 userId 之后，"删别人的"这件事在 SQL 里就不成立
    voices.delete(
        Wrappers.<Voice>lambdaQuery().eq(Voice::getUserId, userId).eq(Voice::getVoiceId, id));
  }

  /* ── 内部 ─────────────────────────────────────────────────────────────── */

  private Voice find(long userId, String voiceId) {
    return voices.selectOne(
        Wrappers.<Voice>lambdaQuery()
            .eq(Voice::getUserId, userId)
            .eq(Voice::getVoiceId, voiceId));
  }

  private void clearChosen(long userId) {
    Voice patch = new Voice();
    patch.setChosen(false);
    voices.update(
        patch,
        Wrappers.<Voice>lambdaQuery().eq(Voice::getUserId, userId).eq(Voice::isChosen, true));
  }

  private static void requireValidId(String voiceId) {
    if (!Voice.validVoiceId(voiceId)) {
      throw ApiException.badRequest("invalid-request", "音色 id 的形状不对");
    }
  }

  private static String trim(String raw) {
    return raw == null ? "" : raw.trim();
  }
}
