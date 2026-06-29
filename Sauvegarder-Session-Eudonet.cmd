@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "SHARE_DIR=%ROOT%share"
set "NODE_EXE=%ROOT%tools\node\node.exe"
set "SCRIPT_JS=%SHARE_DIR%\scripts\saveEudonetSession.js"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%tools\ms-playwright"
set "PW_CHANNEL=chrome"

echo.
echo === Sauvegarde de la session Eudonet ===
echo.

if not exist "%NODE_EXE%" (
  echo [ERREUR] Le moteur Node portable est introuvable.
  echo [INFO] Fichier attendu : "%NODE_EXE%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%SCRIPT_JS%" (
  echo [ERREUR] Le script de sauvegarde Eudonet est introuvable.
  echo [INFO] Fichier attendu : "%SCRIPT_JS%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%PLAYWRIGHT_BROWSERS_PATH%\chromium-1208" (
  echo [ERREUR] Le navigateur Playwright est introuvable.
  echo [INFO] Dossier attendu : "%PLAYWRIGHT_BROWSERS_PATH%\chromium-1208"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

cd /d "%SHARE_DIR%"
"%NODE_EXE%" "%SCRIPT_JS%"
echo.
pause
endlocal
