@echo off
rem Lance l'interface de capture. Au premier lancement sur un PC, prépare tout
rem dans ce dossier : Python isolé (.venv), dépendances, interface web.
rem Rien n'est écrit ailleurs : caches pip / npm / Python dans .cache.
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "PIP_CACHE_DIR=%ROOT%.cache\pip"
set "npm_config_cache=%ROOT%.cache\npm"
set "PYTHONPYCACHEPREFIX=%ROOT%.cache\pycache"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"

rem ---- Python ------------------------------------------------------------
if exist ".venv\Scripts\python.exe" goto venv_ok
echo Preparation de Python (une seule fois)...
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -m venv .venv
) else (
  python -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo.
  echo Python 3.8 ou plus est introuvable. Installez-le depuis https://www.python.org/downloads/
  echo en cochant "Add python.exe to PATH", puis relancez ce fichier.
  pause
  exit /b 1
)
:venv_ok
set "PYTHON=%ROOT%.venv\Scripts\python.exe"
"%PYTHON%" -c "import telethon" >nul 2>nul
if errorlevel 1 (
  echo Installation des dependances Python...
  "%PYTHON%" -m pip install -q -r requirements.txt
  if errorlevel 1 ( echo Echec de l'installation des dependances Python. & pause & exit /b 1 )
)

rem ---- configuration -------------------------------------------------------
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo Fichier .env cree : remplissez API_ID, API_HASH et PHONE ^(https://my.telegram.org^),
  echo enregistrez, puis appuyez sur une touche.
  start "" notepad ".env"
  pause
)

rem ---- Node / interface ----------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js est introuvable. Installez-le depuis https://nodejs.org ^(version LTS^), puis relancez ce fichier.
  pause
  exit /b 1
)
cd web
if not exist node_modules (
  echo Installation de l'interface ^(une seule fois^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Echec de npm install. & pause & exit /b 1 )
)
if not exist ui\dist\index.html (
  call npm run build
  if errorlevel 1 ( echo Echec de la construction de l'interface. & pause & exit /b 1 )
)

if "%PORT%"=="" set "PORT=5174"
start "" http://127.0.0.1:%PORT%
node server.mjs
pause
