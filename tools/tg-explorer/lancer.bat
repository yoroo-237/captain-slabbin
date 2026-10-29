@echo off
cd /d "%~dp0web"
if not exist node_modules call npm install --no-audit --no-fund
if not exist ui\dist call npm run build
start "" http://127.0.0.1:5174
node server.mjs
