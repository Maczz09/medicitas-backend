# CHAOS MONKEY — inyección de fallos ALEATORIOS mientras el sistema está bajo
# carga, para demostrar resiliencia y observabilidad (plan: docs/CHAOS-MONKEY.md).
#
# Qué hace: durante -Duracion minutos, cada 15-40s elige un objetivo al azar,
# lo tumba entre 10 y 30 segundos y lo recupera. Todo queda en chaos-log.txt
# con timestamps para correlacionar con Grafana/Jaeger/Loki.
#
# Objetivos por nivel:
#   modulos (default) → kill-switch de los 9 módulos de negocio (503 limpio).
#   infra             → además: docker stop de redis, rabbitmq, farmacia,
#                       aseguradora, seguros-fallback y workers.
# NUNCA toca: mysql (mataría todo el sistema — eso no es chaos, es apocalipsis),
# nginx (perderías el acceso), ni jaeger/loki/prometheus/grafana (sin
# observabilidad no hay evidencia del experimento).
#
# Uso (con carga corriendo en OTRA terminal: .\run.ps1 full):
#   .\chaos-monkey.ps1                      # 5 min, solo módulos
#   .\chaos-monkey.ps1 -Duracion 10 -Nivel infra
#
# Al terminar (o con Ctrl+C) SIEMPRE restaura todo.

param(
  [int]$Duracion = 5,                                  # minutos
  [ValidateSet('modulos','infra')][string]$Nivel = 'modulos'
)

$Base = if ($env:BASE_URL_HOST) { $env:BASE_URL_HOST } else { 'http://localhost' }
$Log  = Join-Path $PSScriptRoot 'chaos-log.txt'

$Modulos = @('pacientes','medicos','citas','seguros','pagos','historias-clinicas','prescripciones','facturacion','notificaciones')
$Infra   = @{
  'redis'            = 'medicitas_redis'
  'rabbitmq'         = 'medicitas_rabbitmq'
  'workers'          = 'medicitas_workers'
  'farmacia'         = 'farmacia_api'
  'aseguradora'      = 'aseguradora_prosalud_api'
  'seguros-fallback' = 'seguros_fallback_lb'
}

$tocadosInfra = New-Object System.Collections.ArrayList

function Log($msg) {
  $line = "$(Get-Date -Format 'HH:mm:ss') | $msg"
  Write-Host $line
  Add-Content -Path $Log -Value $line
}

function Get-Token {
  (Invoke-RestMethod -Method Post -Uri "$Base/api/v2/auth/login" -ContentType 'application/json' `
    -Body '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}').accessToken
}

function Set-Modulo($nombre, $habilitado) {
  $t = Get-Token
  Invoke-RestMethod -Method Patch -Uri "$Base/api/v2/admin/servicios/$nombre" `
    -Headers @{ Authorization = "Bearer $t" } -ContentType 'application/json' `
    -Body (@{ habilitado = $habilitado } | ConvertTo-Json) | Out-Null
}

function Restaurar-Todo {
  Log "=== RESTAURANDO TODO ==="
  foreach ($m in $Modulos) { try { Set-Modulo $m $true } catch {} }
  foreach ($c in $tocadosInfra) { docker start $c 2>$null | Out-Null }
  Log "=== chaos terminado — todo restaurado ==="
}

"" | Set-Content $Log
Log "=== CHAOS MONKEY inicia: $Duracion min, nivel=$Nivel ==="
Log "(corre la carga en otra terminal: .\run.ps1 full)"

$fin = (Get-Date).AddMinutes($Duracion)
try {
  while ((Get-Date) -lt $fin) {
    # elegir objetivo
    $usarInfra = ($Nivel -eq 'infra') -and ((Get-Random -Maximum 100) -lt 35)   # 35% infra
    $caida = Get-Random -Minimum 10 -Maximum 31                                  # 10-30 s caído

    if ($usarInfra) {
      $k = ($Infra.Keys | Get-Random)
      $c = $Infra[$k]
      Log "CAOS: docker stop $c  (caído ${caida}s)"
      docker stop $c 2>$null | Out-Null
      if (-not $tocadosInfra.Contains($c)) { [void]$tocadosInfra.Add($c) }
      Start-Sleep -Seconds $caida
      Log "RECUPERA: docker start $c"
      docker start $c 2>$null | Out-Null
      [void]$tocadosInfra.Remove($c)
    } else {
      $m = $Modulos | Get-Random
      Log "CAOS: kill-switch OFF '$m'  (caído ${caida}s → responde 503)"
      try { Set-Modulo $m $false } catch { Log "  (patch falló: $_)" }
      Start-Sleep -Seconds $caida
      Log "RECUPERA: kill-switch ON '$m'"
      try { Set-Modulo $m $true } catch { Log "  (patch falló: $_)" }
    }

    $pausa = Get-Random -Minimum 15 -Maximum 41   # 15-40 s de calma
    Start-Sleep -Seconds $pausa
  }
} finally {
  Restaurar-Todo
}

Log "Evidencia: chaos-log.txt + Grafana (dips por módulo) + Jaeger (trazas con 503) + Loki (errores con correlationId)"
