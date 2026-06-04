@echo off
chcp 65001 >nul
title Diagnostico de Rede - Polaris PDV / Firestore
echo Rodando diagnostico... aguarde (pode levar ate 1 minuto).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$cmd = Get-Content -LiteralPath '%~f0'; $start = 0; for($i=0; $i -lt $cmd.Length; $i++){ if($cmd[$i] -eq ':::PS_START:::'){ $start = $i + 1; break } }; $powershellCode = $cmd[$start..($cmd.Length-1)] -join [char]10; Invoke-Expression $powershellCode"
exit /b

:::PS_START:::
$ErrorActionPreference = 'Continue'
$log = Join-Path ([Environment]::GetFolderPath('Desktop')) 'diagnostico-firestore.txt'
Start-Transcript -Path $log -Force | Out-Null

Write-Host '====================================================='
Write-Host '  DIAGNOSTICO DE REDE - FIRESTORE / POLARIS PDV'
Write-Host '====================================================='
Write-Host ('Data/Hora : ' + (Get-Date))
Write-Host ('Computador: ' + $env:COMPUTERNAME)
Write-Host ('Usuario   : ' + $env:USERNAME)
Write-Host ''

Write-Host '--- 1) VERSAO DO CHROME ---'
$chrome = $null
try { $chrome = (Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ErrorAction SilentlyContinue).VersionInfo.ProductVersion } catch {}
if (-not $chrome) { try { $chrome = (Get-Item 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' -ErrorAction SilentlyContinue).VersionInfo.ProductVersion } catch {} }
if ($chrome) { Write-Host ('Chrome: ' + $chrome) } else { Write-Host 'Chrome nao encontrado nas pastas padrao' }
Write-Host ''

Write-Host '--- 2) SERVIDORES DNS CONFIGURADOS ---'
try { Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object {$_.ServerAddresses} | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize | Out-String | Write-Host } catch { Write-Host ('falha: ' + $_.Exception.Message) }
Write-Host ''

Write-Host '--- 3) PROXY DO SISTEMA ---'
netsh winhttp show proxy
try {
  $p = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  Write-Host ('ProxyEnable  : ' + $p.ProxyEnable)
  Write-Host ('ProxyServer  : ' + $p.ProxyServer)
  Write-Host ('AutoConfigURL: ' + $p.AutoConfigURL)
} catch {}
Write-Host ''

Write-Host '--- 4) ARQUIVO HOSTS (entradas ativas) ---'
$hostsFile = Get-Content 'C:\Windows\System32\drivers\etc\hosts' -ErrorAction SilentlyContinue | Where-Object { $_ -and ($_ -notmatch '^\s*#') }
if ($hostsFile) { $hostsFile | Write-Host } else { Write-Host '(sem entradas ativas - normal)' }
Write-Host ''

Write-Host '--- 5) RESOLUCAO DNS de firestore.googleapis.com ---'
try { Resolve-DnsName firestore.googleapis.com -Type A -ErrorAction Stop | Select-Object Name, IPAddress | Format-Table -AutoSize | Out-String | Write-Host } catch { Write-Host ('FALHA DNS: ' + $_.Exception.Message) }
Write-Host ''

Write-Host '--- 6) CONEXAO TCP porta 443 (firestore.googleapis.com) ---'
try { $t = Test-NetConnection firestore.googleapis.com -Port 443 -WarningAction SilentlyContinue; Write-Host ('TcpTestSucceeded: ' + $t.TcpTestSucceeded + '   RemoteAddress: ' + $t.RemoteAddress) } catch { Write-Host ('falha: ' + $_.Exception.Message) }
Write-Host ''

Write-Host '--- 7) TESTE REAL DE LEITURA NO FIRESTORE (REST) ---'
Write-Host '(403 / PERMISSION_DENIED = OTIMO: chegou no Firestore. Timeout/erro de conexao = BLOQUEADO)'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = 'https://firestore.googleapis.com/v1/projects/studio-2243391254-75492/databases/(default)/documents/diag_test?key=AIzaSyAVes6z9Na9FpGkxtq-1HyD9ufrkumHYtA'
try {
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 25
  Write-Host ('HTTP ' + $r.StatusCode)
  Write-Host ($r.Content.Substring(0,[Math]::Min(400,$r.Content.Length)))
} catch {
  $resp = $_.Exception.Response
  if ($resp -ne $null) {
    $body = ''
    try { $sr = New-Object IO.StreamReader($resp.GetResponseStream()); $body = $sr.ReadToEnd() } catch {}
    Write-Host ('HTTP ' + [int]$resp.StatusCode + ' ' + $resp.StatusCode)
    if ($body) { Write-Host ($body.Substring(0,[Math]::Min(400,$body.Length))) }
  } else {
    Write-Host ('ERRO DE CONEXAO (possivel BLOQUEIO): ' + $_.Exception.Message)
  }
}
Write-Host ''

Write-Host '--- 8) TESTE DO CANAL DE TEMPO REAL (streaming / Listen) ---'
Write-Host '(HTTP 400/erro do Google = OK chegou. Timeout/erro de conexao = streaming BLOQUEADO)'
$url2 = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?VER=8&database=projects%2Fstudio-2243391254-75492%2Fdatabases%2F(default)&RID=rpc&SID=test&CI=0&AID=0&TYPE=xmlhttp'
try {
  $r2 = Invoke-WebRequest -Uri $url2 -UseBasicParsing -TimeoutSec 25
  Write-Host ('HTTP ' + $r2.StatusCode + ' (canal ACESSIVEL)')
} catch {
  $resp2 = $_.Exception.Response
  if ($resp2 -ne $null) {
    Write-Host ('HTTP ' + [int]$resp2.StatusCode + ' (canal ACESSIVEL - chegou no Google)')
  } else {
    Write-Host ('ERRO DE CONEXAO (streaming possivelmente BLOQUEADO): ' + $_.Exception.Message)
  }
}
Write-Host ''

Write-Host '--- 9) PING (informativo - ICMP pode ser bloqueado, tudo bem) ---'
ping -n 3 firestore.googleapis.com
Write-Host ''

Write-Host '====================================================='
Write-Host '  FIM DO DIAGNOSTICO'
Write-Host ('  Arquivo salvo em: ' + $log)
Write-Host '====================================================='

Stop-Transcript | Out-Null
try { Start-Process notepad.exe $log } catch {}
