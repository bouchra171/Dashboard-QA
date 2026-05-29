@echo off
echo ========================================
echo    LANCEMENT DES TESTS AUTOMATIQUES
echo    Formulaires INSEEC BACHELOR
echo ========================================
echo.
echo Les tests vont demarrer...
echo Le navigateur va s'ouvrir automatiquement.
echo Ne pas fermer cette fenetre.
echo.
cd /d "%~dp0"
set "PACKAGE_ROOT=%~dp0..\..\.."
set "SHARE_DIR=%PACKAGE_ROOT%\share"
set "NODE_EXE=%PACKAGE_ROOT%\tools\node\node.exe"
set "PLAYWRIGHT_BROWSERS_PATH=%PACKAGE_ROOT%\tools\ms-playwright"
set "PW_CHANNEL="

if not exist "%NODE_EXE%" (
  echo [ERREUR] Le moteur des tests est introuvable.
  echo Reprenez le ZIP complet et dezippez-le avec "Extraire tout".
  pause
  exit /b 1
)

cd /d "%SHARE_DIR%"
"%NODE_EXE%" scripts\fillForm.js
echo.
echo ========================================
echo    TESTS TERMINES
echo    Les rapports sont dans le dossier :
echo    reports/
echo ========================================
echo.
pause
