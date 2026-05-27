@echo off
chcp 65001 >nul
title Cardapio Digital - Instalador Master de Impressao Automatica

set "APP_URL=https://polarispdv.vercel.app/admin"
set "APP_NAME=Cardapio - App Impressao Automatica"
set "PROFILE_DIR=%LOCALAPPDATA%\CardapioDigitalPrintChrome"
set "SHORTCUT=%USERPROFILE%\Desktop\%APP_NAME%.lnk"

echo ========================================================
echo   CONFIGURADOR MASTER DE IMPRESSÃO AUTOMÁTICA
echo ========================================================
echo.
echo Este instalador configurará o computador do cliente:
echo 1. Definirá a impressora padrão do Windows.
echo 2. Criará um atalho dedicado (Modo Aplicativo Silencioso).
echo 3. Configurará qualquer aplicativo PWA instalado do Chrome.
echo.

:: 1. Configurar Impressora Padrão
echo --- 1. CONFIGURAR IMPRESSORA ---
echo Impressoras instaladas neste computador:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Sort-Object Name | Select-Object -ExpandProperty Name"
echo.
set /p PRINTER_NAME=Digite o nome EXATO da impressora térmica (ou ENTER para manter a atual): 

if not "%PRINTER_NAME%"=="" (
  echo.
  echo Definindo "%PRINTER_NAME%" como impressora padrão do Windows...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%PRINTER_NAME%'; if (Get-Printer -Name $p -ErrorAction SilentlyContinue) { (New-Object -ComObject WScript.Network).SetDefaultPrinter($p); Write-Host 'Impressora padrão definida com sucesso!' -ForegroundColor Green } else { Write-Host 'Impressora não encontrada!' -ForegroundColor Red; exit 1 }"
  if errorlevel 1 (
    echo.
    echo Falha ao definir a impressora. Verifique o nome e tente novamente.
    pause
    exit /b 1
  )
)
echo.

:: 2. Criar Atalho Kiosk Dedicado (Modo App)
echo --- 2. CRIANDO ATALHO DEDICADO ---
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not exist "%CHROME_EXE%" (
  echo.
  echo Google Chrome não encontrado neste computador.
  echo Instale o Chrome e execute este script novamente.
  pause
  exit /b 1
)

echo Criando atalho dedicado na Área de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$shortcutPath='%SHORTCUT%'; $chrome='%CHROME_EXE%'; $args='--user-data-dir=\"\"%PROFILE_DIR%\"\" --no-first-run --kiosk-printing --app=\"\"%APP_URL%\"\"'; $shell=New-Object -ComObject WScript.Shell; $s=$shell.CreateShortcut($shortcutPath); $s.TargetPath=$chrome; $s.Arguments=$args; $s.WorkingDirectory=Split-Path $chrome; $s.IconLocation=$chrome + ',0'; $s.Description='Cardapio Digital com impressao automatica'; $s.Save()"

if errorlevel 1 (
  echo.
  echo Alerta: Falha ao criar o atalho dedicado na Área de Trabalho.
) else (
  echo Atalho criado com sucesso: "%SHORTCUT%"
)
echo.

:: 3. Configurar Atalhos de PWA Existentes
echo --- 3. CONFIGURANDO APLICATIVOS PWA INSTALADOS ---
echo Buscando aplicativos Chrome instalados no Desktop e Menu Iniciar...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = Get-Content -LiteralPath '%~f0'; $start = 0; for($i=0; $i -lt $cmd.Length; $i++){ if($cmd[$i] -eq ':::POWERSHELL_START:::'){ $start = $i + 1; break } }; $powershellCode = $cmd[$start..($cmd.Length-1)] -join [char]10; Invoke-Expression $powershellCode"

echo.
echo ========================================================
echo   CONFIGURAÇÃO CONCLUÍDA COM SUCESSO!
echo ========================================================
echo.
echo O cliente pode abrir o sistema de duas formas:
echo 1. Pelo atalho criado: "%APP_NAME%" na Área de Trabalho.
echo 2. Pelo próprio aplicativo instalado (PWA) dele.
echo.
echo Ambas as formas imprimirão automaticamente na impressora padrão!
echo.

set /p OPEN_NOW=Deseja abrir o app agora? Digite S para abrir (ou qualquer outra tecla para sair): 
if /I "%OPEN_NOW%"=="S" (
  if exist "%SHORTCUT%" (
    start "" "%SHORTCUT%"
  ) else (
    start "" "%CHROME_EXE%" --user-data-dir="%PROFILE_DIR%" --no-first-run --kiosk-printing --app="%APP_URL%"
  )
)

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
                Write-Host "[PWA OK] Configurado: $($file.Name)" -ForegroundColor Green
                $modifiedCount++
            } else {
                Write-Host "[PWA OK] Já configurado: $($file.Name)" -ForegroundColor Yellow
                $modifiedCount++
            }
        }
    } catch {}
}

if ($modifiedCount -eq 0) {
    Write-Host "Nenhum atalho de aplicativo PWA foi encontrado para modificar. Isso é normal se você for usar o atalho dedicado." -ForegroundColor Gray
}
