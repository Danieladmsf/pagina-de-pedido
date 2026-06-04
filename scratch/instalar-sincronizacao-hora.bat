@echo off
chcp 65001 >nul
title Instalar Sincronizacao Automatica de Hora - Polaris PDV

:: Auto-eleva para administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = Get-Content -LiteralPath '%~f0'; $start = 0; for($i=0; $i -lt $cmd.Length; $i++){ if($cmd[$i] -eq ':::PS_START:::'){ $start = $i + 1; break } }; $powershellCode = $cmd[$start..($cmd.Length-1)] -join [char]10; Invoke-Expression $powershellCode"
echo.
pause
exit /b

:::PS_START:::
$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:ProgramData 'PolarisPDV'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$helper = Join-Path $dir 'sync-hora.cmd'

$content = @'
@echo off
sc config w32time start= auto >nul 2>&1
net start w32time >nul 2>&1
set /a tries=0
:loop
w32tm /resync /force >nul 2>&1
if not errorlevel 1 goto done
set /a tries+=1
if %tries% geq 8 goto done
ping -n 11 127.0.0.1 >nul
goto loop
:done
'@
Set-Content -Path $helper -Value $content -Encoding ASCII

Write-Host '--- Garantindo o servico de horario ---'
sc.exe config w32time start= auto | Out-Null
Start-Service w32time -ErrorAction SilentlyContinue
w32tm /config /manualpeerlist:"time.google.com,0x9 pool.ntp.org,0x9 time.windows.com,0x9" /syncfromflags:manual /reliable:yes /update | Out-Null

Write-Host '--- Criando tarefas agendadas ---'
$tr = '"' + $helper + '"'
schtasks.exe /create /tn 'PolarisPDV-SyncHora-Logon' /tr $tr /sc ONLOGON /ru SYSTEM /rl HIGHEST /f
schtasks.exe /create /tn 'PolarisPDV-SyncHora-Boot'  /tr $tr /sc ONSTART /ru SYSTEM /rl HIGHEST /delay 0000:30 /f
schtasks.exe /create /tn 'PolarisPDV-SyncHora-Hora'  /tr $tr /sc HOURLY  /ru SYSTEM /rl HIGHEST /f

Write-Host ''
Write-Host '--- Sincronizando a hora agora ---'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $helper -Wait -WindowStyle Hidden
Write-Host ('Hora agora: ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))

Write-Host ''
Write-Host '====================================================='
Write-Host '  PRONTO!'
Write-Host '  A hora sera sincronizada automaticamente:'
Write-Host '   - ao LIGAR o PC (30s apos o boot)'
Write-Host '   - ao fazer LOGIN'
Write-Host '   - a cada 1 HORA'
Write-Host ''
Write-Host '  Isso REDUZ o problema, mas so funciona com internet.'
Write-Host '  A solucao definitiva e TROCAR A BATERIA CR2032.'
Write-Host ''
Write-Host '  Para remover estas tarefas depois, rode:'
Write-Host '   schtasks /delete /tn PolarisPDV-SyncHora-Logon /f'
Write-Host '   schtasks /delete /tn PolarisPDV-SyncHora-Boot /f'
Write-Host '   schtasks /delete /tn PolarisPDV-SyncHora-Hora /f'
Write-Host '====================================================='
