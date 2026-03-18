@echo off
REM start-nanoclaw.bat — Start NanoClaw on Windows
REM To stop: close this window or find and kill the node process

cd /d "%~dp0"

IF EXIST nanoclaw.pid (
  FOR /F %%i IN (nanoclaw.pid) DO (
    taskkill /PID %%i /F >nul 2>&1
  )
  DEL nanoclaw.pid >nul 2>&1
)

echo Starting NanoClaw...
start /B "" "C:\Program Files\nodejs\node.exe" "%~dp0dist\index.js" >> logs\nanoclaw.log 2>> logs\nanoclaw.error.log
echo NanoClaw started.
echo Logs: logs\nanoclaw.log
