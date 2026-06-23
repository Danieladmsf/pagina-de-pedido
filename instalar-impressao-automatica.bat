@echo off
chcp 65001 >nul
title Cardapio Digital - Instalador Master de Impressao Automatica

:: ── Auto-elevação: precisa de Administrador para instalar o QZ Tray e gravar o certificado ──
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"

set "APP_URL=https://polarispdv.vercel.app/"
set "APP_NAME=Cardapio - App Impressao Automatica"
set "PROFILE_DIR=%LOCALAPPDATA%\CardapioDigitalPrintChrome"
set "SHORTCUT=%USERPROFILE%\Desktop\%APP_NAME%.lnk"

echo ========================================================
echo   CONFIGURADOR MASTER DE IMPRESSÃO AUTOMÁTICA
echo   Versao: 2026-06-23 (com QZ Tray)
echo ========================================================
echo.
echo Este instalador configurará o computador do cliente:
echo 1. Definirá a impressora padrão do Windows.
echo 2. Criará um atalho dedicado (Modo Aplicativo Silencioso).
echo 3. Configurará qualquer aplicativo PWA instalado do Chrome.
echo 4. Baixará e instalará o QZ Tray (impressão 100%% silenciosa).
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

:: Detecta a pasta real da Área de Trabalho (compatível com OneDrive)
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP_DIR=%%D"
if not exist "%DESKTOP_DIR%" set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "SHORTCUT=%DESKTOP_DIR%\%APP_NAME%.lnk"
echo Criando atalho dedicado em: %DESKTOP_DIR%
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (!(Test-Path '%PROFILE_DIR%')) { New-Item -ItemType Directory -Force -Path '%PROFILE_DIR%' | Out-Null }; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://polarispdv.vercel.app/favicon.ico' -OutFile '%PROFILE_DIR%\app-icon.ico' -ErrorAction SilentlyContinue } catch {}; $shortcutPath='%SHORTCUT%'; $chrome='%CHROME_EXE%'; $args='--user-data-dir=\"\"%PROFILE_DIR%\"\" --no-first-run --kiosk-printing --app=\"\"%APP_URL%\"\"'; $shell=New-Object -ComObject WScript.Shell; $s=$shell.CreateShortcut($shortcutPath); $s.TargetPath=$chrome; $s.Arguments=$args; $s.WorkingDirectory=Split-Path $chrome; if (Test-Path '%PROFILE_DIR%\app-icon.ico') { $s.IconLocation='%PROFILE_DIR%\app-icon.ico' } else { $s.IconLocation=$chrome + ',0' }; $s.Description='Cardapio Digital com impressao automatica'; $s.Save()"

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

:: 4. Instalar/Configurar QZ Tray (Impressão Silenciosa de verdade)
echo --- 4. QZ TRAY (IMPRESSAO SILENCIOSA) ---
set "QZ_DIR=%ProgramFiles%\QZ Tray"
if not exist "%QZ_DIR%\qz-tray.exe" set "QZ_DIR=%ProgramFiles(x86)%\QZ Tray"

if exist "%QZ_DIR%\qz-tray.exe" goto :qz_have

echo QZ Tray nao encontrado. Baixando e instalando automaticamente (versao mais recente)...
echo (O download tem cerca de 90 MB e a instalacao roda em silencio - aguarde, NAO feche esta janela.)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'x86_64'}; function Get-QzUrl { param($a) try { $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/qzind/tray/releases/latest' -Headers @{ 'User-Agent'='polaris-pdv' }; $as = $rel.assets | Where-Object { $_.name -like ('*' + $a + '.exe') } | Select-Object -First 1; if ($as) { return $as.browser_download_url } } catch {}; try { Invoke-WebRequest -Uri 'https://github.com/qzind/tray/releases/latest' -MaximumRedirection 0 -Headers @{ 'User-Agent'='polaris-pdv' } | Out-Null } catch { $loc = $_.Exception.Response.Headers['Location']; if ($loc -match 'tag/v?([0-9.]+)') { $v = $matches[1]; return ('https://github.com/qzind/tray/releases/download/v' + $v + '/qz-tray-' + $v + '-' + $a + '.exe') } }; return $null }; $out = Join-Path $env:TEMP ('qz-tray-' + $arch + '.exe'); $ok = $false; for ($i=1; $i -le 3 -and -not $ok; $i++) { try { $url = Get-QzUrl $arch; if (-not $url) { Write-Host ('Tentativa ' + $i + ': nao consegui o link, repetindo...') -ForegroundColor Yellow; Start-Sleep -Seconds 4; continue }; Write-Host ('Baixando QZ Tray (tentativa ' + $i + ' de 3, ~90 MB, aguarde)...'); Invoke-WebRequest -Uri $url -OutFile $out; if ((Get-Item $out).Length -gt 10MB) { $ok = $true } else { Write-Host 'Download incompleto, repetindo...' -ForegroundColor Yellow; Start-Sleep -Seconds 4 } } catch { Write-Host ('Falha na tentativa ' + $i + ': ' + $_.Exception.Message) -ForegroundColor Yellow; Start-Sleep -Seconds 4 } }; if (-not $ok) { Write-Host 'Nao foi possivel baixar o QZ Tray apos 3 tentativas.' -ForegroundColor Red; exit 1 }; Write-Host 'Download concluido. Instalando em modo silencioso (ate 1 minuto)...'; $p = Start-Process -FilePath $out -ArgumentList '/S' -Wait -PassThru; Write-Host ('Instalacao finalizada (codigo ' + $p.ExitCode + ').'); exit $p.ExitCode"

:: re-detecta apos a instalacao
set "QZ_DIR=%ProgramFiles%\QZ Tray"
if not exist "%QZ_DIR%\qz-tray.exe" set "QZ_DIR=%ProgramFiles(x86)%\QZ Tray"
if not exist "%QZ_DIR%\qz-tray.exe" goto :qz_failed
echo QZ Tray instalado com sucesso.

:qz_have
echo QZ Tray em: %QZ_DIR%
echo Instalando certificado confiavel (override.crt)...

set "CERT_TMP=%TEMP%\polaris-override.crt"
> "%CERT_TMP%" echo -----BEGIN CERTIFICATE-----
>> "%CERT_TMP%" echo MIIDNTCCAh2gAwIBAgIUWT0eyyJy5HFea2HOOvvC46oba0QwDQYJKoZIhvcNAQEL
>> "%CERT_TMP%" echo BQAwKjETMBEGA1UEAwwKUG9sYXJpc1BEVjETMBEGA1UECgwKUG9sYXJpc1BEVjAe
>> "%CERT_TMP%" echo Fw0yNjA2MDYxMzA4NTRaFw00NjA2MDExMzA4NTRaMCoxEzARBgNVBAMMClBvbGFy
>> "%CERT_TMP%" echo aXNQRFYxEzARBgNVBAoMClBvbGFyaXNQRFYwggEiMA0GCSqGSIb3DQEBAQUAA4IB
>> "%CERT_TMP%" echo DwAwggEKAoIBAQDUEnkYIrFkd3jhZG/28W6CrhHv+8jYeKZUbZN1Ev/E1KdIGQ1F
>> "%CERT_TMP%" echo c4xUJ0NAVq5uWJJP6K5R9vAGUsmWmwU5/COs6YrHS153n15NdBWm70ZrjvyL41BL
>> "%CERT_TMP%" echo Fi2DAfZGck1yvuNZL90A0Fo0pdJLEWpSR0NBPrKHoe9+5ZvzORC9QyVI0DKcC/eE
>> "%CERT_TMP%" echo sJC8JlmJsmumHBrguE+7ujblBzHb4P7h5sRKV2ZScG7+oyfyuDBaW1qUL+9Ya2le
>> "%CERT_TMP%" echo iw9yM94MohqZkIE+CnZ/yxUzpkiV6i7L0hSQsavKvQrKR/xEdkLGSchTod8JpPEu
>> "%CERT_TMP%" echo YiwpJJOToJEsBkfGQ3bcMLpPx2KxLhSkj8pFAgMBAAGjUzBRMB0GA1UdDgQWBBQs
>> "%CERT_TMP%" echo b/A6T/Z7pADetxD0PE6T4r7w5jAfBgNVHSMEGDAWgBQsb/A6T/Z7pADetxD0PE6T
>> "%CERT_TMP%" echo 4r7w5jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQALiVrcpwCj
>> "%CERT_TMP%" echo r6pMQYApY5q/b/uhKlRYb+HIHTRctsZSTWmMAxyPLL+TPNX/+B9BSrYTfVqpoyHj
>> "%CERT_TMP%" echo 7XT8HG2L0JcgBpUcRxp4kHxDxLqpDsZ+OnCDWt50aqLzs4DUsFFwBy8DjSw5bPkk
>> "%CERT_TMP%" echo l39apnepQ9ehQuq82RGlZRaQdkm4R4hQ7kN9EDiiH5YpPnRXyrDZOOaB3qdPMHy8
>> "%CERT_TMP%" echo 3lN5foZBed4JqmYXeW+HBG159tU4R4vz1FqdQ61aIIQxhgKIK89xy9EbE6m9ZTEe
>> "%CERT_TMP%" echo nKBJzuPznY18sCEoQ3uWG5TVZyvjzVNkdpI5KOeZOgqWOylwQPhWgisdf6GtvVA6
>> "%CERT_TMP%" echo KKupa8nH/svd
>> "%CERT_TMP%" echo -----END CERTIFICATE-----

copy /Y "%CERT_TMP%" "%QZ_DIR%\override.crt" >nul

if exist "%QZ_DIR%\override.crt" (
  echo Certificado instalado com sucesso.
  echo Reiniciando o QZ Tray...
  taskkill /IM qz-tray.exe /F >nul 2>&1
  start "" "%QZ_DIR%\qz-tray.exe"
  echo QZ Tray pronto para impressao silenciosa.
) else (
  echo ATENCAO: nao foi possivel copiar o certificado para "%QZ_DIR%\override.crt".
)
goto :qz_done

:qz_failed
echo ATENCAO: falha ao instalar o QZ Tray automaticamente.
echo Instale manualmente em https://qz.io/download/ e rode este instalador de novo.
echo (Sem o QZ Tray, o sistema continua imprimindo pelo atalho Chrome acima.)

:qz_done
echo.

:: Verificacao final: o QZ Tray ficou mesmo instalado?
echo --- VERIFICACAO FINAL ---
set "QZ_CHECK=%ProgramFiles%\QZ Tray"
if not exist "%QZ_CHECK%\qz-tray.exe" set "QZ_CHECK=%ProgramFiles(x86)%\QZ Tray"
if exist "%QZ_CHECK%\qz-tray.exe" (
  if exist "%QZ_CHECK%\override.crt" (
    powershell -NoProfile -Command "Write-Host '[OK] QZ Tray instalado + certificado: impressao silenciosa pronta.' -ForegroundColor Green"
  ) else (
    powershell -NoProfile -Command "Write-Host '[AVISO] QZ Tray instalado, mas o certificado override.crt NAO foi gravado. Vai aparecer um popup pedindo permissao na 1a impressao.' -ForegroundColor Yellow"
  )
) else (
  powershell -NoProfile -Command "Write-Host '===================================================='   -ForegroundColor Red; Write-Host ' [ERRO] QZ TRAY NAO FOI INSTALADO!'                  -ForegroundColor Red; Write-Host ' A impressao 100%% silenciosa NAO vai funcionar.'   -ForegroundColor Red; Write-Host ' Verifique a internet e rode este instalador de novo'-ForegroundColor Yellow; Write-Host ' ou instale manual em https://qz.io/download/'      -ForegroundColor Yellow; Write-Host '===================================================='   -ForegroundColor Red"
)
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
