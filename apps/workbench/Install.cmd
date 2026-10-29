@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows.ps1" -Action Install
set "result=%errorlevel%"
if not "%result%"=="0" echo Operation failed. Review the message above.
pause
exit /b %result%
