# 06 —— `SettingsProvider` 收缩成 `VoiceProvider`，删掉那个抽屉

`Status:` **open**

## 要做什么

「模型与密钥」这个抽屉整格拆掉（用户 2026-10-16：取消用户自己填 api-key 的模块）。
但 `SettingsProvider` **不能跟着一起删**——它里面还住着音色那一半：

- 新 `src/components/voices/VoiceProvider.tsx` + `src/lib/voices/state.ts`：
  `{ voices, current, myVoices, setVoice, rememberVoice, forgetVoice, canNarrate }`。
  `canNarrate` 的判据从"用户填齐了 key + 模型 + 音色"变成
  **"服务端配齐了语音 + 这个人有语音权限 + 选了一个音色"**——三个条件，
  缺哪个界面就该说哪个（不再是笼统的"还没配齐"）。
- 删：`src/components/settings/`（抽屉 + Provider + css）、`src/lib/settings/state.ts`、
  `src/app/api/settings/probe`。
- 七个调用点改名：`CreateLanding`、`GenerationSetupDialog`、`GenerationRun`、
  `ChildDetail`、`NewChild`、`NewVoicePanel`、`VoicePicker`。
- `src/app/layout.tsx`：`SettingsProvider` → `VoiceProvider`。

★ 为什么值得改名而不是留着旧名字：那个名字会开始撒谎（里面没有"模型与密钥"了），
而下一个读它的人会去里面找 key。代价是七个调用点的一次机械改名——一次做完。

## 怎么算做完

- 侧栏底部没有「模型与密钥」了；界面上**任何地方都填不了 api-key**。
- 音色那两件事还活着：预置的两个音色能选、能试听；录一个克隆音色仍然能用。
- 三条闸门全绿。
