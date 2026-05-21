@echo off
chcp 65001 >nul
title Cardapio Digital - Configurar Impressao Automatica

set "APP_URL=https://pagina-de-pedido.vercel.app/admin"
set "PROFILE_DIR=%LOCALAPPDATA%\CardapioDigitalPrintChrome"

echo ============================================
echo   CONFIGURAR IMPRESSAO AUTOMATICA
echo ============================================
echo.

echo Impressoras instaladas:
powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"
echo.

set /p PRINTER_NAME=Digite o nome EXATO da impressora termica, ou ENTER para manter a padrao atual: 

if not "%PRINTER_NAME%"=="" (
  echo.
  echo Definindo impressora padrao...
  powershell -NoProfile -Command "$p='%PRINTER_NAME%'; if (Get-Printer -Name $p -ErrorAction SilentlyContinue) { (New-Object -ComObject WScript.Network).SetDefaultPrinter($p); Write-Host 'OK' } else { Write-Host 'Impressora nao encontrada'; exit 1 }"
  if errorlevel 1 pause & exit /b 1
)

set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME_EXE%" (
  echo Chrome nao encontrado. Instale o Google Chrome.
  pause
  exit /b 1
)

set "SHORTCUT=%USERPROFILE%\Desktop\Cardapio - Impressao Direta.lnk"

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%'); $s.TargetPath='%CHROME_EXE%'; $s.Arguments='--user-data-dir=""%PROFILE_DIR%"" --no-first-run --kiosk-printing --app=""%APP_URL%""'; $s.WorkingDirectory='%ProgramFiles%\Google\Chrome\Application'; $s.IconLocation='%CHROME_EXE%,0'; $s.Save()"

echo.
echo Atalho criado na Area de Trabalho:
echo Cardapio - Impressao Direta
echo.
echo Use SEMPRE esse atalho para abrir o painel.
echo Assim a impressao sai direto, sem abrir o modal do navegador.
echo.
pause
