@echo off
setlocal

chcp 65001 >nul 2>&1
if errorlevel 1 (
  chcp 936 >nul
)

where py >nul 2>&1
if %errorlevel%==0 (
  py -3 "%~dp0main.py" %*
) else (
  python "%~dp0main.py" %*
)
