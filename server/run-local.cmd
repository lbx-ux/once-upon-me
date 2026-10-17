@echo off
rem ============================================================================
rem run-local.cmd -- start the backend locally (Windows)
rem
rem     & .\server\run-local.cmd            (from PowerShell)
rem     server\run-local.cmd                 (from cmd.exe)
rem
rem It does one thing: load the repo-root .env.local into the environment, then
rem run `mvn spring-boot:run`.
rem
rem Why it exists: the Java side does NOT read .env.local (it reads process env,
rem and on the server /etc/xiaozhujue/api.yml -- see the tail of .env.example).
rem Without APP_JWT_SECRET it generates a RANDOM one, and the symptom is
rem "login returns 200, then every request is 401" -- indistinguishable from a
rem broken auth implementation (we hit exactly that once). So that value has to
rem match the frontend byte for byte, and nobody should have to retype it.
rem
rem Why the comments are in English: cmd.exe reads a .bat/.cmd in the OEM code
rem page (936 here), so UTF-8 Chinese comments come out as garbage *commands*.
rem The Chinese explanation lives in README (section 3) instead.
rem
rem `-o` = offline build; the dependencies are already in the local repo.
rem Drop it if a dependency is genuinely missing.
rem ============================================================================
setlocal
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0..\.env.local") do set "%%A=%%B"
cd /d "%~dp0"
call mvn -o spring-boot:run
