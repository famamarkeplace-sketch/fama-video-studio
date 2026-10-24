@echo off
cd /d "%~dp0"
title FAMA Video Studio - FAMA Records
where node >nul 2>nul
if errorlevel 1 (
 echo No se encontro Node.js.
 echo Instala Node.js LTS desde https://nodejs.org y vuelve a abrir este archivo.
 pause
 exit /b 1
)
if not exist node_modules (
 echo Preparando FAMA Video Studio. La primera vez puede tardar unos minutos...
 call npm install
 if errorlevel 1 (
  echo No se pudieron instalar las dependencias. Comprueba internet y vuelve a intentarlo.
  pause
  exit /b 1
 )
)
start "" http://127.0.0.1:8787
call npm start
echo.
echo El servidor se ha detenido.
pause
