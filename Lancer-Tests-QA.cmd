@echo off
setlocal

set "ROOT=%~dp0"
set "SHARE_DIR=%ROOT%share"
set "NODE_EXE=%ROOT%tools\node\node.exe"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%tools\ms-playwright"
set "PACKAGE_JSON=%SHARE_DIR%\package.json"
set "CAMPAIGN_SCRIPT=%SHARE_DIR%\scripts\runCampaign.js"
set "PLAYWRIGHT_CLI=%SHARE_DIR%\node_modules\playwright\cli.js"
set "LATEST_REPORT=%SHARE_DIR%\reports\business\latest\resume-fonctionnel.html"

echo [INFO] Preparation des tests automatises...

if not exist "%SHARE_DIR%" (
  echo [ERREUR] Le dossier share est introuvable.
  echo [INFO] Dezippez completement le package avant de lancer ce fichier.
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%CAMPAIGN_SCRIPT%" (
  echo [ERREUR] Le script de tests est introuvable.
  echo [INFO] Fichier attendu : "%CAMPAIGN_SCRIPT%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%NODE_EXE%" (
  echo [ERREUR] Le moteur des tests est introuvable.
  echo [INFO] Le package est incomplet. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  echo [INFO] Fichier attendu : "%NODE_EXE%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%PLAYWRIGHT_CLI%" (
  echo [ERREUR] Les dependances de tests sont introuvables.
  echo [INFO] Le package est incomplet. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  echo [INFO] Fichier attendu : "%PLAYWRIGHT_CLI%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%PLAYWRIGHT_BROWSERS_PATH%\chromium-1208" (
  echo [ERREUR] Le navigateur de test est introuvable.
  echo [INFO] Le package est incomplet. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  echo [INFO] Dossier attendu : "%PLAYWRIGHT_BROWSERS_PATH%\chromium-1208"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

set "PW_CHANNEL="

echo [INFO] Lancement de la campagne de tests...
call "%NODE_EXE%" "%CAMPAIGN_SCRIPT%" --campaign tnr-front-recette
set "TEST_EXIT=%ERRORLEVEL%"

if not "%TEST_EXIT%"=="0" (
  echo [ERREUR] La campagne s'est terminee avec des anomalies.
  if exist "%LATEST_REPORT%" (
    echo [INFO] Ouverture du dernier rapport...
    start "" "%LATEST_REPORT%"
  ) else (
    echo [ERREUR] Le dernier rapport est introuvable.
  )
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b %TEST_EXIT%
)

echo [OK] Tests termines.
if exist "%LATEST_REPORT%" (
  echo [INFO] Ouverture du dernier rapport...
  start "" "%LATEST_REPORT%"
) else (
  echo [ERREUR] Le dernier rapport est introuvable.
)

echo [INFO] Appuyez sur une touche pour fermer.
pause >nul
endlocal
