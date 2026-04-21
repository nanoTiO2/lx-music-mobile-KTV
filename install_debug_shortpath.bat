@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>&1
call "%~dp0build_debug_shortpath.bat"
if errorlevel 1 exit /b %errorlevel%

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$apks = Get-ChildItem -Path '%~dp0android\\app\\build\\outputs\\apk\\debug' -Filter *.apk -Recurse | Sort-Object LastWriteTimeUtc -Descending; if ($apks.Count -gt 0) { $apks[0].FullName }"`) do (
  set "APK_PATH=%%I"
)

if not defined APK_PATH (
  echo [install_debug_shortpath] debug apk not found.
  exit /b 1
)

echo [install_debug_shortpath] installing %APK_PATH%
adb install -r -d "%APK_PATH%"
exit /b %ERRORLEVEL%
