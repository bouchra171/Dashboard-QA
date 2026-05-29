@echo off
setlocal

set "SHARE_ROOT=%~dp0"
for %%I in ("%SHARE_ROOT%..") do set "PACKAGE_ROOT=%%~fI"
set "NODE_EXE=%PACKAGE_ROOT%\tools\node\node.exe"
set "PLAYWRIGHT_BROWSERS_PATH=%PACKAGE_ROOT%\tools\ms-playwright"
set "SERVER_DIR=%SHARE_ROOT%react-dashboard-package"
set "SERVER_JS=%SERVER_DIR%\server.js"
set "WAIT_JS=%SERVER_DIR%\wait-and-open.js"
set "SERVER_OUT=%PACKAGE_ROOT%\server-dashboard.out.txt"
set "SERVER_ERR=%PACKAGE_ROOT%\server-dashboard.err.txt"
set "DASHBOARD_URL=http://127.0.0.1:4173/"

echo [INFO] Preparation du dashboard QA...

if not exist "%NODE_EXE%" (
  echo [ERREUR] Le moteur du dashboard est introuvable.
  echo [INFO] Le package est incomplet. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  echo [INFO] Fichier attendu : "%NODE_EXE%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%SERVER_JS%" (
  echo [ERREUR] Le dossier du dashboard est introuvable.
  echo [INFO] Fichier attendu : "%SERVER_JS%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

if not exist "%WAIT_JS%" (
  echo [ERREUR] Le script de verification du dashboard est introuvable.
  echo [INFO] Le package est incomplet. Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  echo [INFO] Fichier attendu : "%WAIT_JS%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

echo [INFO] Demarrage du serveur du dashboard...
echo [INFO] Les journaux seront crees ici en cas de probleme :
echo        "%SERVER_OUT%"
echo        "%SERVER_ERR%"

del "%SERVER_OUT%" >nul 2>nul
del "%SERVER_ERR%" >nul 2>nul

start "QA Dashboard Server" /min cmd /c "set ""PLAYWRIGHT_BROWSERS_PATH=%PLAYWRIGHT_BROWSERS_PATH%"" && set ""PW_CHANNEL="" && cd /d ""%SERVER_DIR%"" && ""%NODE_EXE%"" ""%SERVER_JS%"" 1>""%SERVER_OUT%"" 2>""%SERVER_ERR%"""

"%NODE_EXE%" "%WAIT_JS%" "%DASHBOARD_URL%api/health" "%DASHBOARD_URL%"

if errorlevel 1 (
  echo [ERREUR] Le dashboard ne repond pas.
  echo [INFO] Fermez cette fenetre puis envoyez a l'equipe QA une capture de ce message.
  echo [INFO] Envoyez aussi ces fichiers s'ils existent :
  echo        "%SERVER_OUT%"
  echo        "%SERVER_ERR%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

echo [OK] Dashboard lance dans le navigateur.
endlocal
