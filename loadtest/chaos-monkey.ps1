# CHAOS MONKEY — inyección de fallos ALEATORIOS mientras el sistema está bajo
# carga, para demostrar resiliencia y observabilidad (plan: docs/CHAOS-MONKEY.md).
#
# Qué hace: durante -Duracion minutos, cada 15-40s elige un objetivo al azar,
# lo tumba entre 10 y 30 segundos y lo recupera. Todo queda en chaos-log.txt
# con timestamps para correlacionar con Grafana/Jaeger/Loki.
#
# Objetivos por nivel:
#   modulos (default) → kill-switch de los 9 módulos de negocio (503 limpio).
#   infra             → además: mata el PID 1 DENTRO de redis, rabbitmq,
#                       farmacia, aseguradora, seguros-fallback o workers. No
#                       usa `docker stop` ni `docker kill` a propósito: ambos
#                       son detención explícita y `restart: unless-stopped` los
#                       respeta (NO reinicia). Solo matando el proceso desde
#                       dentro Docker revive el contenedor solo. El log registra
#                       el RestartCount antes/después como evidencia.
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
  # -Encoding UTF8 explícito: Add-Content en PowerShell 5.1 escribe en ANSI
  # (Windows-1252) por defecto, y los acentos y flechas del log salían como
  # "caÃ­do"/"â†'" al abrir el archivo en cualquier editor moderno (UTF-8).
  # chaos-log.txt es la evidencia del experimento — tiene que ser legible.
  Add-Content -Path $Log -Value $line -Encoding UTF8
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

"" | Set-Content $Log -Encoding UTF8
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
      # docker KILL, no stop. Todos estos contenedores tienen `restart:
      # unless-stopped`, y esa política solo reinicia cuando el contenedor muere
      # POR SÍ SOLO. Un `docker stop` —y también un `docker kill`— cuenta como
      # detención EXPLÍCITA del operador: Docker respeta esa decisión y NO lo
      # reinicia. Verificado en vivo: tras `docker kill`, RestartCount se queda
      # en 0 y el contenedor permanece 'exited'. Con ese método, quien revivía
      # el servicio era el `docker start` de este script — el experimento
      # demostraba que el SCRIPT sabe levantar contenedores, no que el SISTEMA
      # se auto-recupera.
      #
      # Matar el PID 1 DESDE DENTRO sí es una muerte propia: Docker aplica la
      # política y lo revive solo (verificado: RestartCount pasa de 0 a 1 y
      # vuelve a 'running' sin intervención). Todas las imágenes objetivo son
      # alpine, así que tienen el `kill` de busybox.
      $antes = [int](docker inspect $c --format '{{.RestartCount}}' 2>$null)
      Log "CAOS: matando PID 1 dentro de $c  (muerte propia — Docker debe revivirlo solo)"
      docker exec $c kill 1 2>$null | Out-Null
      if (-not $tocadosInfra.Contains($c)) { [void]$tocadosInfra.Add($c) }
      Start-Sleep -Seconds $caida

      # Evidencia dura de auto-recuperación: RestartCount tuvo que INCREMENTAR.
      # Si solo se mirara 'running' no se distinguiría "volvió solo" de "nunca
      # llegó a caer". El `docker start` queda de red de seguridad para no dejar
      # el sistema roto si la política fallara.
      $despues = [int](docker inspect $c --format '{{.RestartCount}}' 2>$null)
      $estado  = (docker inspect $c --format '{{.State.Status}}' 2>$null)
      if ($estado -eq 'running' -and $despues -gt $antes) {
        Log "AUTO-RECUPERADO: $c volvió solo por su restart policy (RestartCount $antes -> $despues)"
      } elseif ($estado -eq 'running') {
        Log "OK: $c sigue 'running' (RestartCount $antes -> $despues; puede no haber alcanzado a morir)"
      } else {
        Log "SIN auto-recuperación ($c quedó '$estado') — levantando a mano"
        docker start $c 2>$null | Out-Null
      }
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
