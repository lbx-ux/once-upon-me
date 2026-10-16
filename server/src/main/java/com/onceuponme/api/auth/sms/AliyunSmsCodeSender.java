package com.onceuponme.api.auth.sms;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import com.aliyun.dypnsapi20170525.Client;
import com.aliyun.dypnsapi20170525.models.SendSmsVerifyCodeRequest;
import com.aliyun.dypnsapi20170525.models.SendSmsVerifyCodeResponse;
import com.aliyun.tea.TeaException;
import com.aliyun.teaopenapi.models.Config;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.onceuponme.api.config.AppProperties;
import com.onceuponme.api.support.ApiException;

import jakarta.annotation.PostConstruct;

/**
 * 阿里云**号码认证服务**（真通道）——用户那份文档里的那条路。
 *
 * <p>★ 为什么是它，而不是看起来更"正统"的短信服务（`dysmsapi`）：
 * 2026-10-16 用站长自己的 AccessKey 量过（探针在 `.out/aliyun-probe/`，未进仓库）：
 *
 * <ul>
 *   <li>短信服务那边 `QuerySmsSignList` 回 <b>totalCount=0</b> —— 这个账号**一条签名都没有**，
 *       于是 `SendSms` 一律回 `isv.SMS_SIGNATURE_ILLEGAL`（"该账号下找不到对应签名"）。
 *       我一度就是照着一张某模板的截图把它换过去的，那次判断是错的；
 *   <li>号码认证这边用文档里那对值（签名 `恒创联众` / 模板 `100001`）回
 *       `code=OK success=true`，**一条真短信发到了手机上**，而
 *       `CheckSmsVerifyCode` 对那个码回 `verifyResult=PASS`。
 * </ul>
 *
 * <p>★ 用法上有一处**刻意与文档不同**，写清理由：模板参数传的是**具体的码**
 * （`{"code":"482913","min":"5"}`），不是 `##code##`。文档对前者的原话是
 * 「阿里云接口无法校验」——所以核验在 {@link SmsCodeStore} 里，是我们自己做的。
 * 换来的是**一个码最多试 5 次**：交给厂商核验时，"这个码被试了几次"对我们完全不可见，
 * 六位数字的爆破也就无从拦起。两个接口（发/验）的能力我们都有，这一处选的是更严的那条。
 *
 * <p>★ 错误分三类回不同的话，因为下一步完全不同：签名/模板/功能没开通 → 这是**配置错了**，
 * 要说清楚（否则要在"没收到短信"上查一小时）；触发厂商频控 → 429；其它 → 502。
 */
@Component
@ConditionalOnProperty(name = "app.sms.enabled", havingValue = "true", matchIfMissing = true)
public class AliyunSmsCodeSender implements SmsCodeSender {

  private static final Logger log = LoggerFactory.getLogger(AliyunSmsCodeSender.class);

  private static final String ENDPOINT = "dypnsapi.aliyuncs.com";
  private static final long CODE_LENGTH = 6L;
  private static final long VALID_SECONDS = 300L;
  /** 与本地第一层频控同一个数（60 秒）。★ 两处都写 60 是有意的：它们是同一件事的两道闸 */
  private static final long INTERVAL_SECONDS = 60L;

  private final AppProperties.Sms sms;
  private final ObjectMapper json;
  private final SmsCodeStore codes;

  private Client client;

  public AliyunSmsCodeSender(AppProperties properties, ObjectMapper json, SmsCodeStore codes) {
    this.sms = properties.sms();
    this.json = json;
    this.codes = codes;
  }

  @PostConstruct
  void init() throws Exception {
    // 不在这里检查"四项配了没有"：没配时启动就失败了（见 StartupChecks）
    Config config =
        new Config().setAccessKeyId(sms.accessKeyId()).setAccessKeySecret(sms.accessKeySecret());
    config.endpoint = ENDPOINT;
    this.client = new Client(config);
  }

  @Override
  public void send(String phone) {
    // ★ 我们自己生成码并记下来（见类注释：这一条换来"一个码最多试 5 次"）
    String code = codes.issue(phone);

    // ★ 用 Map + Jackson 拼模板参数，不用字符串拼：它是模板里的 `${code}`，
    //   手写引号在"值里带引号"这类情况下会拼出坏 JSON，报错只有一句"参数不合法"
    Map<String, String> templateParam = new LinkedHashMap<>();
    templateParam.put("code", code);
    templateParam.put("min", "5");
    String paramJson;
    try {
      paramJson = json.writeValueAsString(templateParam);
    } catch (JsonProcessingException ex) {
      codes.discard(phone);
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "sms-bad-param", "程序出错，请过一段时间再试");
    }

    SendSmsVerifyCodeRequest request =
        new SendSmsVerifyCodeRequest()
            .setPhoneNumber(phone)
            .setSignName(sms.signName())
            .setTemplateCode(sms.templateCode())
            .setTemplateParam(paramJson)
            .setCodeLength(CODE_LENGTH)
            .setValidTime(VALID_SECONDS)
            .setInterval(INTERVAL_SECONDS);

    try {
      SendSmsVerifyCodeResponse response = client.sendSmsVerifyCode(request);
      var body = response.getBody();
      if (body != null && "OK".equals(body.getCode())) {
        log.info("验证码已发出，号段 {}", mask(phone));
        return;
      }
      String code2 = body == null ? "?" : body.getCode();
      String message = body == null ? "?" : body.getMessage();
      log.error("验证码发送失败：code={} message={}", code2, message);
      codes.discard(phone);
      throw classify(code2);
    } catch (TeaException ex) {
      // ★ 只记 code 与 message，**不记密钥**（这个仓库里"密钥不进日志"是一条承诺）
      log.error("调用发送接口失败：code={} message={}", ex.getCode(), ex.getMessage());
      codes.discard(phone);
      throw classify(ex.getCode());
    } catch (ApiException ex) {
      throw ex;
    } catch (Exception ex) {
      log.error("调用发送接口遇到未知异常", ex);
      codes.discard(phone);
      throw new ApiException(HttpStatus.BAD_GATEWAY, "sms-send-failed", "验证码没发出去，请稍后再试");
    }
  }

  @Override
  public boolean verify(String phone, String code) {
    boolean passed = codes.check(phone, code);
    if (passed) {
      log.info("验证码核验通过，号段 {}", mask(phone));
    } else {
      // 核验失败不记 warn 以上：它是日常，每记一条都会在真出事那天变成噪音
      log.debug("验证码核验未通过，号段 {}", mask(phone));
    }
    return passed;
  }

  @Override
  public boolean devMode() {
    return false;
  }

  /**
   * 厂商的错误码 → 一句人话。★ 只区分"我们能做的三件事"，其余一律归到最后那一类
   * ——穷举阿里云的错误码表是没有尽头的。
   *
   * <p>那几个码名来自文档 §二「错误码」表，以及这一轮实测撞到的
   * `isv.SMS_SIGNATURE_ILLEGAL`（它连短信服务那侧都会回，所以两边一起认）。
   */
  private static ApiException classify(String aliyunCode) {
    String code = aliyunCode == null ? "" : aliyunCode;

    if (code.contains("BUSINESS_LIMIT_CONTROL") || code.contains("FREQUENCY_FAIL")) {
      return ApiException.tooMany("这个号码发得太频了，请明天再试");
    }
    if (code.contains("MOBILE_NUMBER_ILLEGAL") || code.contains("isv.MOBILE_NUMBER")) {
      return ApiException.badRequest("mobile-illegal", "这个手机号服务商不收，请检查一下");
    }
    if (code.contains("SIGNATURE")
        || code.contains("TEMPLATE")
        || code.contains("FUNCTION_NOT_OPENED")) {
      // ★ 这一类是**配置错了**（签名名/模板 CODE 与账号里的对不上、号码认证没开通），
      //   说清楚才能免掉"在那查为什么收不到短信"的一小时
      return new ApiException(
          HttpStatus.BAD_GATEWAY,
          "sms-config",
          "短信签名或模板被拒了（"
              + code
              + "）：去号码认证控制台确认「赠送签名」的名字与「赠送模板」的 CODE 就是配在服务端的这两个");
    }
    return new ApiException(HttpStatus.BAD_GATEWAY, "sms-send-failed", "验证码没发出去，请稍后再试");
  }

  /** 日志里只留号段。★ 手机号是个人信息，整串写进日志是这件仓库不允许的那类事 */
  private static String mask(String phone) {
    return phone != null && phone.length() == 11
        ? phone.substring(0, 3) + "****" + phone.substring(7)
        : "***";
  }
}
