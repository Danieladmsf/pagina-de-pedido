@echo off
chcp 65001 >nul
title Cardapio Digital - Atualizar e Instalar Impressao Automatica
echo ========================================================
echo   BAIXANDO A VERSAO MAIS RECENTE DO INSTALADOR...
echo ========================================================
echo.
echo Este atalho SEMPRE baixa a versao mais nova direto do servidor,
echo entao voce nunca roda uma copia antiga por engano.
echo.

set "URL=https://polarispdv.vercel.app/instalar-impressao-automatica.bat"
set "DEST=%TEMP%\instalar-impressao-automatica.bat"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { $u = '%URL%?t=' + [DateTimeOffset]::Now.ToUnixTimeSeconds(); Invoke-WebRequest -Uri $u -OutFile '%DEST%' -Headers @{ 'Cache-Control'='no-cache'; 'Pragma'='no-cache' }; Write-Host 'Download concluido.' -ForegroundColor Green } catch { Write-Host ('Falha no download: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
  echo.
  echo Nao foi possivel baixar o instalador. Verifique a internet e tente de novo.
  pause
  exit /b 1
)

echo.
echo Abrindo o instalador atualizado (ele pedira permissao de Administrador)...
echo.
call "%DEST%"
exit /b
