@echo off
REM Update Backup Script for KrushFlow (Windows)
REM Run this anytime to sync the latest working files to backup\

echo Updating backup folder...
echo.

REM Create backup directory if it doesn't exist
if not exist backup mkdir backup

REM Copy core application files
echo Copying core files...
copy /Y package.json backup\ >nul
copy /Y server.js backup\ >nul
copy /Y index.html backup\ >nul
copy /Y nixpacks.toml backup\ >nul
copy /Y pnpm-lock.yaml backup\ >nul

REM Copy configuration files
echo Copying config files...
copy /Y .env.example backup\.env.example >nul 2>&1
copy /Y .npmrc backup\.npmrc >nul 2>&1
copy /Y .gitignore backup\.gitignore >nul 2>&1
copy /Y railway.toml backup\ >nul 2>&1
copy /Y README.md backup\ >nul 2>&1
copy /Y setup.bash backup\ >nul 2>&1

REM Copy assets
echo Copying assets...
copy /Y logo.svg backup\ >nul 2>&1
copy /Y logo.png backup\ >nul 2>&1
copy /Y live_count.svg backup\ >nul 2>&1
copy /Y new_project.svg backup\ >nul 2>&1
copy /Y voice_mapping.svg backup\ >nul 2>&1

REM Show summary
echo.
echo Backup updated successfully!
echo Location: %CD%\backup\
echo Backup timestamp: %date% %time% > backup\LAST_UPDATED.txt
echo.
pause
