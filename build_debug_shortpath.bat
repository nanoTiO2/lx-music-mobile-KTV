@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>&1
set "ROOT=%~dp0"
set "SHORT_DRIVE="

for %%D in (Z Y X W V U T S R Q P O N M) do (
  if not defined SHORT_DRIVE (
    subst %%D: "%ROOT:~0,-1%" >nul 2>&1
    if not errorlevel 1 (
      set "SHORT_DRIVE=%%D:"
    )
  )
)

if not defined SHORT_DRIVE (
  echo [build_debug_shortpath] failed to allocate subst drive.
  exit /b 1
)

echo [build_debug_shortpath] using %SHORT_DRIVE%
pushd "%SHORT_DRIVE%\android"
call gradlew.bat assembleDebug
set "EXIT_CODE=%ERRORLEVEL%"
popd
subst %SHORT_DRIVE% /d >nul 2>&1
exit /b %EXIT_CODE%
