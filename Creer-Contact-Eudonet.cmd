@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "NODE_EXE=%ROOT%tools\node\node.exe"
set "SCRIPT_JS=%ROOT%share\scripts\openEudonetNewContact.js"
set "DATA_JSON=%ROOT%share\data\eudonet\contact-test.json"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%tools\ms-playwright"
set "PW_CHANNEL=chrome"

echo.
echo === Creation d'un contact Eudonet ===
echo.

if not exist "%NODE_EXE%" (
  echo [ERREUR] Le moteur Node portable est introuvable.
  pause
  exit /b 1
)

if not exist "%SCRIPT_JS%" (
  echo [ERREUR] Le script Eudonet est introuvable.
  pause
  exit /b 1
)

if not exist "%DATA_JSON%" (
  echo [ERREUR] Le fichier de donnees est introuvable : "%DATA_JSON%"
  pause
  exit /b 1
)

if not exist "%ROOT%authentification\eudonet-session.json" (
  echo [ERREUR] La session Eudonet est absente.
  echo [INFO] Lancez d'abord Sauvegarder-Session-Eudonet.cmd.
  pause
  exit /b 1
)

cd /d "%ROOT%"
"%NODE_EXE%" "%SCRIPT_JS%" --data "%DATA_JSON%" --submit --keep-open-ms 10000
set "TEST_EXIT=%ERRORLEVEL%"

if not "%TEST_EXIT%"=="0" (
  echo.
  echo [ERREUR] La creation du contact a echoue.
  echo [INFO] Consultez authentification\eudonet-new-contact.log et authentification\eudonet-new-contact.png.
  pause
  exit /b %TEST_EXIT%
)

echo.
echo [OK] Le scenario de creation du contact est termine.
pause
endlocal
