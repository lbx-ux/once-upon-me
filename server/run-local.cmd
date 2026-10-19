@echo off
rem ============================================================================
rem run-local.cmd -- start the backend locally (Windows). The real entry point.
rem
rem     & .\server\run-local.cmd            (from PowerShell)
rem     server\run-local.cmd                 (from cmd.exe)
rem     & .\server\run-local.cmd -Dspring-boot.run.arguments=--app.sms.enabled=true
rem
rem It is a three-line wrapper now: the work (parse .env.local, pin APP_H2_PATH,
rem run maven) lives in run-local.mjs next to this file, and that file's header
rem explains every reason in Chinese.
rem
rem Why the wrapper at all: cmd.exe reads a .bat/.cmd in the OEM code page (936
rem here), so UTF-8 Chinese comments come out as garbage *commands*. Keeping the
rem Chinese rationale in a .mjs and leaving only ASCII here is the whole trick.
rem
rem Why the logic moved (2026-10-19): cmd's `for /f "eol=# ..."` over .env.local
rem silently DROPPED 2 of its 21 keys (APP_SMS_ENABLED, BACKEND_URL) because the
rem file is LF-terminated and its comments are Chinese -- and which line gets
rem eaten depends on its position in the file. Node parses it the same way every
rem time. See docs/known-tradeoffs.md, "cmd 读 .env.local 会吞行" section.
rem ============================================================================
node "%~dp0run-local.mjs" %*
