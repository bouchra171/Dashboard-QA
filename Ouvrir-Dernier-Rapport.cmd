@echo off
setlocal

set "ROOT=%~dp0"
set "LATEST_REPORT=%ROOT%share\reports\business\latest\resume-fonctionnel.html"
set "LATEST_DASHBOARD=%ROOT%share\reports\business\latest\dashboard-metier.html"

if exist "%LATEST_REPORT%" (
  echo [OK] Ouverture du dernier rapport fonctionnel.
  start "" "%LATEST_REPORT%"
  endlocal
  exit /b 0
)

if exist "%LATEST_DASHBOARD%" (
  echo [OK] Ouverture du dernier dashboard metier.
  start "" "%LATEST_DASHBOARD%"
  endlocal
  exit /b 0
)

echo [ERREUR] Aucun rapport recent n'a ete trouve.
echo [INFO] Lancez d'abord les tests automatises.
echo [INFO] Appuyez sur une touche pour fermer.
pause >nul
exit /b 1
