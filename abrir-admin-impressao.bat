@echo off
echo ============================================
echo   CARDAPIO DIGITAL - Modo Impressao Direta
echo ============================================
echo.
echo Abrindo Chrome com impressao silenciosa...
echo A impressora padrao do Windows sera usada.
echo.
echo IMPORTANTE: configure a impressora termica como
echo impressora padrao do Windows antes de iniciar.
echo.

set "APP_URL=%~1"
if "%APP_URL%"=="" set "APP_URL=https://pagina-de-pedido.vercel.app/admin"

set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME_EXE%" (
  echo Chrome nao encontrado. Instale o Google Chrome neste computador.
  pause
  exit /b 1
)

start "" "%CHROME_EXE%" --user-data-dir="%LOCALAPPDATA%\CardapioDigitalPrintChrome" --no-first-run --kiosk-printing --app="%APP_URL%"

echo Chrome aberto em modo impressao direta:
echo %APP_URL%
echo.
echo Com este atalho, window.print sai direto na impressora padrao.
echo.
pause
