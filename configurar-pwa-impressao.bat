@echo off
title Configurar Aplicativo Chrome - Impressao Automatica

echo ========================================================
echo   CONFIGURADOR DE IMPRESSAO AUTOMATICA (APP CHROME PWA)
echo ========================================================
echo.
echo Este script configura o Aplicativo (PWA) baixado
echo pelo Chrome no computador para imprimir diretamente
echo na impressora padrao, sem abrir o modal do navegador.
echo.

:: 1. Configurar Impressora Padrao
echo --- 1. CONFIGURAR IMPRESSORA ---
echo Impressoras instaladas neste computador:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name"
echo.
set /p PRINTER_NAME=Digite o nome EXATO da impressora termica (ou ENTER para manter a atual): 

if "%PRINTER_NAME%"=="" goto skip_printer

echo.
echo Definindo "%PRINTER_NAME%" como impressora padrao do Windows...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%PRINTER_NAME%'; if (Get-Printer -Name $p -ErrorAction SilentlyContinue) { (New-Object -ComObject WScript.Network).SetDefaultPrinter($p); Write-Host 'Impressora padrao definida com sucesso!' -ForegroundColor Green } else { Write-Host 'Impressora nao encontrada!' -ForegroundColor Red; exit 1 }"

if not errorlevel 1 goto skip_printer
echo.
echo Falha ao definir impressora. Verifique se o nome esta correto e tente novamente.
pause
exit /b 1

:skip_printer
echo.

:: 2. Modificar os atalhos de PWA do Chrome/Edge
echo --- 2. CONFIGURAR ATALHOS DO APLICATIVO ---
echo Buscando aplicativos instalados no Desktop e Menu Iniciar...
echo.

:: Executa a busca e modificação usando a lógica robusta em PowerShell extraída do próprio arquivo
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = Get-Content -LiteralPath '%~f0'; $start = 0; for($i=0; $i -lt $cmd.Length; $i++){ if($cmd[$i] -eq ':::POWERSHELL_START:::'){ $start = $i + 1; break } }; $powershellCode = $cmd[$start..($cmd.Length-1)] -join [char]10; Invoke-Expression $powershellCode"

echo.
echo ========================================================
echo CONFIGURACAO CONCLUIDA!
echo.
echo IMPORTANTE:
echo Se o aplicativo estiver aberto, feche TODAS as janelas
echo do Chrome e do Aplicativo e reabra-o pelo atalho.
echo ========================================================
echo.
pause
exit /b

:::POWERSHELL_START:::
$searchPaths = [System.Collections.Generic.List[string]]::new()
$searchPaths.Add("$env:USERPROFILE\Desktop")
$searchPaths.Add("$env:USERPROFILE\OneDrive\Desktop")
$searchPaths.Add("C:\Users\Public\Desktop")
$searchPaths.Add("$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
$searchPaths.Add("$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu")

if (Test-Path "C:\Users" -ErrorAction SilentlyContinue) {
    Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $userDir = $_.FullName
        $desktops = @(
            (Join-Path $userDir "Desktop"),
            (Join-Path $userDir "Area de Trabalho")
        )
        Get-ChildItem $userDir -Directory -Filter "OneDrive*" -ErrorAction SilentlyContinue | ForEach-Object {
            $desktops += (Join-Path $_.FullName "Desktop")
            $desktops += (Join-Path $_.FullName "Area de Trabalho")
        }
        foreach ($d in $desktops) {
            try {
                if (Test-Path $d -ErrorAction SilentlyContinue) { $searchPaths.Add($d) }
            } catch {}
        }
        $startMenuBase = Join-Path $userDir "AppData\Roaming\Microsoft\Windows\Start Menu\Programs"
        try {
            if (Test-Path $startMenuBase -ErrorAction SilentlyContinue) {
                $searchPaths.Add($startMenuBase)
            }
        } catch {}
    }
}

$publicStartMenu = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs"
try {
    if (Test-Path $publicStartMenu -ErrorAction SilentlyContinue) { $searchPaths.Add($publicStartMenu) }
} catch {}

$uniquePaths = $searchPaths | Select-Object -Unique
$files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
$sh = New-Object -ComObject WScript.Shell

foreach ($path in $uniquePaths) {
    try {
        if (Test-Path $path -ErrorAction SilentlyContinue) {
            $recurse = $path -match "Start Menu|Programs|Menu Iniciar"
            if ($recurse) {
                $found = Get-ChildItem -Path $path -Filter *.lnk -Recurse -ErrorAction SilentlyContinue
            } else {
                $found = Get-ChildItem -Path $path -Filter *.lnk -ErrorAction SilentlyContinue
            }
            if ($found) {
                foreach ($f in $found) { $files.Add($f) }
            }
        }
    } catch {}
}

$uniqueFiles = $files | Group-Object FullName | ForEach-Object { $_.Group[0] }
$modifiedCount = 0

foreach ($file in $uniqueFiles) {
    try {
        $lnk = $sh.CreateShortcut($file.FullName)
        if ($lnk.Arguments -like '*--app-id=*') {
            if ($lnk.Arguments -notlike '*--kiosk-printing*') {
                $lnk.Arguments = $lnk.Arguments + ' --kiosk-printing'
                $lnk.Save()
                Write-Host "[OK] Configurado: $($file.Name)" -ForegroundColor Green
                $modifiedCount++
            } else {
                Write-Host "[OK] Ja estava configurado: $($file.Name)" -ForegroundColor Yellow
                $modifiedCount++
            }
        }
    } catch {}
}

if ($modifiedCount -eq 0) {
    Write-Host "Nenhum atalho de aplicativo PWA do Chrome foi encontrado no Desktop ou no Menu Iniciar." -ForegroundColor Red
    Write-Host "Instale o cardapio como Aplicativo (clicando no icone de instalar na barra do Chrome) antes de rodar." -ForegroundColor Red
}
