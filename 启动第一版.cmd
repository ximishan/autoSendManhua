@echo off
cd /d "%~dp0"
if not exist node_modules\electron\package.json (
  echo Please run npm install in this folder first.
  pause
  exit /b 1
)
call npm start
if errorlevel 1 pause
