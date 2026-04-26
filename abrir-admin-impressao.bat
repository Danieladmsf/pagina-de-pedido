@echo off
echo ============================================
echo   CARDAPIO DIGITAL - Modo Impressao Direta
echo ============================================
echo.
echo Abrindo Chrome com impressao silenciosa...
echo A impressora padrao do Windows sera usada.
echo.
echo IMPORTANTE: Certifique-se que a EPSON TM-T20
echo esta configurada como impressora padrao!
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing http://localhost:3000/admin

echo Chrome aberto! Ao clicar em "Recebido" ou no
echo icone de impressora, o cupom sai direto na EPSON.
echo.
pause
