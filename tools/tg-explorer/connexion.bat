@echo off
rem Connexion Telegram d'un profil (ouvert par l'interface, ou double-clic).
rem Usage : connexion.bat [profil]
cd /d "%~dp0"
set "PROFILE=%~1"
if "%PROFILE%"=="" set "PROFILE=explorer"
if not defined PYTHON (
  if exist ".venv\Scripts\python.exe" (set "PYTHON=%~dp0.venv\Scripts\python.exe") else (set "PYTHON=python")
)
set "PYTHONPYCACHEPREFIX=%~dp0.cache\pycache"
"%PYTHON%" login.py --profile %PROFILE%
