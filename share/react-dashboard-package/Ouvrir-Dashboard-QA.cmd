@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "SHARE_ROOT=%%~fI"
set "LAUNCHER=%SHARE_ROOT%\CMDQA.cmd"

if not exist "%LAUNCHER%" (
    echo [ERREUR] Le lanceur est introuvable :
    echo "%LAUNCHER%"
    echo.
    echo Verifiez que le dossier contient bien :
    echo share\CMDQA.cmd
    echo share\react-dashboard-package\server.js
    echo.
    echo [INFO] Appuyez sur une touche pour fermer.
    pause >nul
    exit /b 1
)

call "%LAUNCHER%"

if errorlevel 1 (
    echo.
    echo [ERREUR] Le dashboard ne s'est pas lance correctement.
    echo [INFO] Appuyez sur une touche pour fermer.
    pause >nul
)
