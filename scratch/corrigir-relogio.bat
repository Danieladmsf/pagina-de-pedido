@echo off
chcp 65001 >nul
title Corrigir Relogio / Sincronizacao de Hora - Polaris PDV

:: Auto-eleva para administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo =====================================================
echo   CORRECAO DE HORARIO - POLARIS PDV
echo =====================================================
echo.
echo Hora atual da maquina:
powershell -NoProfile -Command "Get-Date -Format 'dd/MM/yyyy HH:mm:ss'"
echo.
echo Fuso horario configurado:
tzutil /g
echo.

echo --- 1) Habilitando o servico de horario (W32Time) ---
sc config w32time start= auto
net start w32time
echo.

echo --- 2) Configurando servidores de horario (Google / NTP) ---
w32tm /config /manualpeerlist:"time.google.com,0x9 pool.ntp.org,0x9 time.windows.com,0x9" /syncfromflags:manual /reliable:yes /update
echo.

echo --- 3) Reiniciando o servico ---
net stop w32time
net start w32time
echo.

echo --- 4) Forcando sincronizacao ---
w32tm /resync /force
echo.

echo --- 5) Status da sincronizacao ---
w32tm /query /status
echo.

echo Hora DEPOIS da correcao:
powershell -NoProfile -Command "Get-Date -Format 'dd/MM/yyyy HH:mm:ss'"
echo.
echo =====================================================
echo   PRONTO.
echo   1) Confira se a data/hora acima esta CORRETA.
echo   2) Abra o app e teste criar uma mesa.
echo.
echo   IMPORTANTE: se a hora VOLTAR a ficar errada depois
echo   de desligar/reiniciar o PC, a BATERIA DA PLACA-MAE
echo   (CR2032) esta gasta e precisa ser trocada (item barato).
echo =====================================================
echo.
pause
