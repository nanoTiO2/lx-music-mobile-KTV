@echo off
setlocal

chcp 65001 >nul 2>&1
pushd "%~dp0"
node scripts\prompt_ws_relay.js
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
