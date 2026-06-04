@echo off
chcp 65001 >nul
title Diagnostico de Relogio / Bateria - Polaris PDV
echo Coletando historico de hora... aguarde alguns segundos.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = Get-Content -LiteralPath '%~f0'; $start = 0; for($i=0; $i -lt $cmd.Length; $i++){ if($cmd[$i] -eq ':::PS_START:::'){ $start = $i + 1; break } }; $powershellCode = $cmd[$start..($cmd.Length-1)] -join [char]10; Invoke-Expression $powershellCode"
exit /b

:::PS_START:::
$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
function Add-Line($t){ $out.Add([string]$t); Write-Host $t }

Add-Line '====================================================='
Add-Line '  DIAGNOSTICO DE RELOGIO / BATERIA - POLARIS PDV'
Add-Line '====================================================='
Add-Line ('Agora        : ' + (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))
Add-Line ('Fuso horario : ' + (tzutil /g))
Add-Line ('Computador   : ' + $env:COMPUTERNAME)
Add-Line ''

Add-Line '--- SERVICO DE HORARIO (W32Time) ---'
try { $svc = Get-Service w32time -ErrorAction Stop; Add-Line ('Status: ' + $svc.Status + '   |   Inicializacao: ' + $svc.StartType) } catch { Add-Line ('falha: ' + $_.Exception.Message) }
Add-Line ''

Add-Line '--- STATUS DA SINCRONIZACAO ---'
foreach($l in (w32tm /query /status 2>&1)){ Add-Line $l }
Add-Line ''

Add-Line '--- ULTIMO BOOT DO WINDOWS ---'
try { $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop; Add-Line ('LastBootUpTime: ' + $os.LastBootUpTime) } catch { Add-Line ('falha: ' + $_.Exception.Message) }
Add-Line ''

Add-Line '--- HISTORICO DE MUDANCAS DE HORA (ultimas 20) ---'
Add-Line '(SALTOS grandes (centenas/milhares de min) logo apos o boot = sinal de BATERIA GASTA)'
Add-Line ''
try {
  $evts = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-General'; Id=1} -MaxEvents 20 -ErrorAction Stop
  foreach($e in $evts){
    $quando = $e.TimeCreated.ToString('dd/MM/yyyy HH:mm:ss')
    $novo = $null; $velho = $null
    try { $novo = $e.Properties[0].Value } catch {}
    try { $velho = $e.Properties[1].Value } catch {}
    if(($novo -is [datetime]) -and ($velho -is [datetime])){
      $delta = [math]::Round((New-TimeSpan -Start $velho -End $novo).TotalMinutes,1)
      Add-Line ('[' + $quando + ']  de ' + $velho.ToString('dd/MM HH:mm:ss') + '  ->  ' + $novo.ToString('dd/MM HH:mm:ss') + '   (SALTO: ' + $delta + ' min)')
    } else {
      $m = ($e.Message -replace '\s+',' ').Trim()
      Add-Line ('[' + $quando + ']  ' + $m.Substring(0,[Math]::Min(160,$m.Length)))
    }
  }
} catch { Add-Line ('(sem eventos ou erro: ' + $_.Exception.Message + ')') }
Add-Line ''

Add-Line '--- EVENTOS DO SERVICO DE HORARIO (ultimos 10) ---'
try {
  $evts2 = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Time-Service'} -MaxEvents 10 -ErrorAction Stop
  foreach($e in $evts2){
    $m = ($e.Message -replace '\s+',' ').Trim()
    Add-Line ('[' + $e.TimeCreated.ToString('dd/MM HH:mm:ss') + '] Id=' + $e.Id + '  ' + $m.Substring(0,[Math]::Min(150,$m.Length)))
  }
} catch { Add-Line ('(sem eventos: ' + $_.Exception.Message + ')') }
Add-Line ''

Add-Line '====================================================='
Add-Line '  FIM'
Add-Line '====================================================='

$logPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'diagnostico-relogio.txt'
try { $out | Set-Content -Path $logPath -Encoding UTF8; Add-Line ('Arquivo salvo em: ' + $logPath) } catch {}
try { Start-Process notepad.exe $logPath } catch {}
