@echo off
setlocal

set "ROOT=%~dp0"
set "LAUNCHER=%ROOT%share\CMDQA.cmd"

if not exist "%LAUNCHER%" (
  echo [ERREUR] Le lanceur share\CMDQA.cmd est introuvable.
  echo [INFO] Dezippez completement le package puis lancez ce fichier depuis le dossier extrait.
  echo [INFO] Emplacement attendu : "%LAUNCHER%"
  echo [INFO] Appuyez sur une touche pour fermer.
  pause >nul
  exit /b 1
)

call "%LAUNCHER%"
exit /b %ERRORLEVEL%
endlocal
