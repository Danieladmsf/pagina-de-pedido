@echo off
chcp 65001 >nul
title Cardapio Digital - App com Impressao Automatica

set "APP_URL=https://pagina-de-pedido.vercel.app/admin"
set "APP_NAME=Cardapio - App Impressao Automatica"
set "PROFILE_DIR=%LOCALAPPDATA%\CardapioDigitalPrintChrome"
set "SHORTCUT=%USERPROFILE%\Desktop\%APP_NAME%.lnk"

echo ============================================
echo   CARDAPIO DIGITAL - APP + IMPRESSAO DIRETA
echo ============================================
echo.
echo Este script cria um atalho em modo aplicativo.
echo Ao abrir por ele, a impressao sai direto na impressora padrao.
echo.

echo Impressoras instaladas:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name"
echo.

set /p PRINTER_NAME=Digite o nome EXATO da impressora termica, ou ENTER para manter a padrao atual: 

if not "%PRINTER_NAME%"=="" (
  echo.
  echo Definindo impressora padrao...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%PRINTER_NAME%'; if (Get-Printer -Name $p -ErrorAction SilentlyContinue) { (New-Object -ComObject WScript.Network).SetDefaultPrinter($p); Write-Host 'Impressora padrao definida:' $p } else { Write-Host 'Impressora nao encontrada:' $p; exit 1 }"
  if errorlevel 1 (
    echo.
    echo Nao foi possivel definir a impressora padrao.
    pause
    exit /b 1
  )
)

set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME_EXE%" (
  echo.
  echo Google Chrome nao encontrado neste computador.
  echo Instale o Chrome e rode este arquivo novamente.
  pause
  exit /b 1
)

echo.
echo Criando atalho na Area de Trabalho...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shortcutPath='%SHORTCUT%'; $chrome='%CHROME_EXE%'; $args='--user-data-dir=""%PROFILE_DIR%"" --no-first-run --kiosk-printing --app=""%APP_URL%""'; $shell=New-Object -ComObject WScript.Shell; $s=$shell.CreateShortcut($shortcutPath); $s.TargetPath=$chrome; $s.Arguments=$args; $s.WorkingDirectory=Split-Path $chrome; $s.IconLocation=$chrome + ',0'; $s.Description='Cardapio Digital com impressao automatica'; $s.Save()"

if errorlevel 1 (
  echo.
  echo Falha ao criar o atalho.
  pause
  exit /b 1
)

echo.
echo Atalho criado:
echo %SHORTCUT%
echo.
echo IMPORTANTE:
echo 1. Abra o painel SEMPRE por este atalho.
echo 2. Se abrir pelo Chrome normal, o modal de impressao pode aparecer.
echo 3. A impressora padrao do Windows sera usada.
echo.

set /p OPEN_NOW=Deseja abrir o app agora? Digite S para abrir: 
if /I "%OPEN_NOW%"=="S" (
  start "" "%SHORTCUT%"
)

echo.
echo Configuracao finalizada.
pause
