# Verificador de OBSERVABILIDAD end-to-end — corre esto cuando "no se ven las
# trazas" o "no salen los logs" en cualquier máquina, y te dice exactamente qué
# pieza está rota y cómo arreglarla.
#
# Chequea los 3 pilares: TRAZAS (Jaeger), MÉTRICAS (Prometheus :9091 agregado),
# LOGS (Loki), más el estado del stack. Genera 1 petición de prueba para que
# haya al menos una traza fresca.
#
# Uso:  .\verificar-observabilidad.ps1

$ErrorActionPreference = 'SilentlyContinue'
$fallos = 0

function OK($msg)   { Write-Host "  [OK]    $msg" -ForegroundColor Green }
function FAIL($msg, $fix) {
  Write-Host "  [FALLA] $msg" -ForegroundColor Red
  if ($fix) { Write-Host "          FIX: $fix" -ForegroundColor Yellow }
  $script:fallos++
}

Write-Host "`n=== 1) Contenedores del stack ===" -ForegroundColor Cyan
$esperados = @('medicitas_backend','medicitas_jaeger','medicitas_loki','medicitas_promtail','medicitas_prometheus','medicitas_grafana','medicitas_mysql','medicitas_rabbitmq','medicitas_redis','medicitas_workers')
$corriendo = docker ps --format '{{.Names}}'
foreach ($c in $esperados) {
  if ($corriendo -contains $c) { OK $c }
  else { FAIL "$c NO está corriendo" "docker compose up -d  (o docker start $c). Si es jaeger: NUNCA lo pares para las pruebas." }
}

Write-Host "`n=== 2) OpenTelemetry en el backend ===" -ForegroundColor Cyan
$otel = docker exec medicitas_backend sh -c 'echo $OTEL_SDK_DISABLED'
if ($otel -eq 'true') {
  FAIL "OTEL_SDK_DISABLED=true → el backend NO exporta trazas (por eso Jaeger no muestra medicitas-backend)" `
    "haz git pull (el default del repo ya es false) y recrea: docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --force-recreate backend workers"
} else { OK "OTEL_SDK_DISABLED=$otel (trazas activas)" }

$tracing = docker logs medicitas_backend 2>&1 | Select-String 'Tracing' | Select-Object -Last 1
if ("$tracing" -match 'iniciado') { OK "SDK: $($tracing.ToString().Trim())" }
elseif ("$tracing" -match 'DESACTIVADO') { FAIL "El SDK arrancó DESACTIVADO: $tracing" "recrea el contenedor tras el git pull (ver fix anterior)" }
else { FAIL "No se encontró la línea [Tracing] en los logs del backend" "docker restart medicitas_backend y revisa 'docker logs medicitas_backend | Select-String Tracing'" }

Write-Host "`n=== 3) Generando 1 petición de prueba (login) ===" -ForegroundColor Cyan
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost/api/v2/auth/login' -ContentType 'application/json' `
  -Body '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}'
if ($login.accessToken) { OK "login 200 → traza generada" } else { FAIL "login falló" "¿nginx arriba? ¿XAMPP peleando por el puerto 80?" }
Start-Sleep -Seconds 6

Write-Host "`n=== 4) TRAZAS — Jaeger ===" -ForegroundColor Cyan
$svcs = (Invoke-RestMethod -Uri 'http://localhost:16686/api/services').data
if ($svcs -contains 'medicitas-backend') { OK "Jaeger lista 'medicitas-backend' (servicios: $($svcs -join ', '))" }
else { FAIL "Jaeger NO lista medicitas-backend (solo: $($svcs -join ', '))" "casi siempre es OTel apagado (paso 2). Jaeger solo lista un servicio tras recibir su PRIMERA traza." }

Write-Host "`n=== 5) MÉTRICAS — Prometheus (target :9091 agregado) ===" -ForegroundColor Cyan
$targets = (Invoke-RestMethod -Uri 'http://localhost:9090/api/v1/targets').data.activeTargets
$b = $targets | Where-Object { $_.labels.job -eq 'medicitas-backend' }
if ($b -and $b.health -eq 'up' -and $b.scrapeUrl -match '9091') { OK "Prometheus scrapea $($b.scrapeUrl) (health: up)" }
elseif ($b -and $b.scrapeUrl -notmatch '9091') { FAIL "Prometheus scrapea $($b.scrapeUrl) — config VIEJA (debe ser :9091, el endpoint agregado del cluster)" "git pull (monitoring/prometheus.yml) y docker restart medicitas_prometheus" }
elseif ($b) { FAIL "target medicitas-backend health=$($b.health): $($b.lastError)" "docker restart medicitas_backend medicitas_prometheus" }
else { FAIL "Prometheus no tiene el job medicitas-backend" "git pull + docker restart medicitas_prometheus" }

Write-Host "`n=== 6) LOGS — Loki ===" -ForegroundColor Cyan
$q = [uri]::EscapeDataString('sum(count_over_time({app="medicitas-backend"}[10m]))')
$loki = Invoke-RestMethod -Uri "http://localhost:3100/loki/api/v1/query?query=$q"
$lineas = if ($loki.data.result.Count -gt 0) { $loki.data.result[0].value[1] } else { 0 }
if ([int]$lineas -gt 0) { OK "Loki tiene $lineas líneas de medicitas-backend en los últimos 10 min" }
else { FAIL "Loki NO tiene logs recientes de medicitas-backend" "¿promtail arriba? docker restart medicitas_promtail. En Grafana usa Explore → datasource Loki → {app=`"medicitas-backend`"}" }

Write-Host "`n=== 7) Salud profunda del backend ===" -ForegroundColor Cyan
# node en vez de wget: el wget de busybox NO imprime el body cuando el status
# es 503, y el body es justo lo que dice QUÉ dependencia está caída.
function Leer-Ready {
  docker exec medicitas_backend node -e "const http=require('http');http.get('http://localhost:3000/health/ready',r=>{let d='';r.on('data',c=>d+=c).on('end',()=>console.log(d))}).on('error',()=>console.log(''));" | ConvertFrom-Json
}
$ready = Leer-Ready
# Reintento: tras un up/recreate, RabbitMQ tarda unos segundos en reconectar.
if ($ready.status -ne 'READY') { Start-Sleep -Seconds 8; $ready = Leer-Ready }
if ($ready.status -eq 'READY') { OK "readiness READY (mysql/redis/rabbitmq up)" }
else { FAIL "readiness: $($ready | ConvertTo-Json -Compress)" "docker restart medicitas_backend medicitas_workers (suele ser RabbitMQ que arrancó después que el backend)" }

Write-Host ""
if ($fallos -eq 0) {
  Write-Host "TODO OK — observabilidad al 100%. Corre .\run.ps1 observabilidad y abre Jaeger/Grafana." -ForegroundColor Green
} else {
  Write-Host "$fallos problema(s) encontrados — aplica los FIX de arriba en orden." -ForegroundColor Red
}
