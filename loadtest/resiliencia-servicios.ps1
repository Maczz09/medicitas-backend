# Resiliencia servicio-por-servicio — UN comando por servicio para dar de baja
# y recuperar CADA pieza del sistema, y observar la degradación grácil.
#
# NUNCA toca Jaeger (para no perder la observabilidad durante la prueba).
#
# Dos tipos de "caída":
#   A) MÓDULOS de negocio (kill-switch, dentro del monolito): PATCH al admin.
#      El módulo responde 503; el RESTO del sistema sigue 100%.
#   B) DEPENDENCIAS de infra (contenedores): docker stop.
#      Demuestra reintentos, circuit breakers y acumulación en outbox.
#
# Uso:
#   .\resiliencia-servicios.ps1 estado                 # ver qué módulos están arriba
#   .\resiliencia-servicios.ps1 baja   citas           # bajar un módulo de negocio
#   .\resiliencia-servicios.ps1 sube   citas           # recuperarlo
#   .\resiliencia-servicios.ps1 baja-todos             # bajar los 9 módulos
#   .\resiliencia-servicios.ps1 sube-todos             # recuperar los 9 módulos
#   .\resiliencia-servicios.ps1 infra-baja  rabbitmq   # parar un contenedor de infra
#   .\resiliencia-servicios.ps1 infra-sube  rabbitmq   # levantarlo
#
# Correr EN PARALELO una carga sostenida (otra terminal) para ver el efecto:
#   .\run.ps1 full            # o  .\run.ps1 observabilidad

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('estado','baja','sube','baja-todos','sube-todos','infra-baja','infra-sube')]
  [string]$Accion,
  [string]$Servicio
)

$Base = if ($env:BASE_URL_HOST) { $env:BASE_URL_HOST } else { 'http://localhost' }

# Los 9 módulos de negocio toggleables por kill-switch (lista del backend).
$Modulos = @('pacientes','medicos','citas','seguros','pagos','historias-clinicas','prescripciones','facturacion','notificaciones')

# Contenedores de infra que se pueden parar (Jaeger EXCLUIDO a propósito).
$InfraMap = @{
  'mysql'            = 'medicitas_mysql'      # BD principal
  'redis'            = 'medicitas_redis'      # caché + kill-switch + idempotencia
  'rabbitmq'         = 'medicitas_rabbitmq'   # bus de eventos (outbox acumula)
  'nginx'            = 'medicitas_nginx'      # gateway
  'workers'          = 'medicitas_workers'    # outbox worker + crons
  'farmacia'         = 'farmacia_api'         # externo → circuit breaker + receta contingencia
  'aseguradora'      = 'aseguradora_prosalud_api'  # externo → fallback de seguros
  'seguros-fallback' = 'seguros_fallback_lb'  # servicio de respaldo de pólizas
}

function Get-Token {
  $r = Invoke-RestMethod -Method Post -Uri "$Base/api/v2/auth/login" `
    -ContentType 'application/json' `
    -Body '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}'
  return $r.accessToken
}

function Set-Modulo($nombre, $habilitado) {
  $token = Get-Token
  $body = @{ habilitado = $habilitado } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Patch -Uri "$Base/api/v2/admin/servicios/$nombre" `
    -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
  $estado = if ($r.data.habilitado) { 'ARRIBA' } else { 'DE BAJA (503)' }
  Write-Host ("  {0,-20} -> {1}" -f $nombre, $estado) -ForegroundColor (if ($habilitado) { 'Green' } else { 'Yellow' })
}

switch ($Accion) {
  'estado' {
    $token = Get-Token
    $r = Invoke-RestMethod -Uri "$Base/api/v2/admin/servicios" -Headers @{ Authorization = "Bearer $token" }
    Write-Host "Estado de los modulos de negocio:" -ForegroundColor Cyan
    foreach ($m in $Modulos) {
      $up = $r.data.$m
      $txt = if ($up) { 'ARRIBA' } else { 'DE BAJA (503)' }
      Write-Host ("  {0,-20} {1}" -f $m, $txt) -ForegroundColor (if ($up) { 'Green' } else { 'Yellow' })
    }
  }
  'baja' {
    if (-not $Servicio) { Write-Host "Falta el nombre del modulo. Opciones: $($Modulos -join ', ')" -ForegroundColor Red; break }
    Set-Modulo $Servicio $false
  }
  'sube' {
    if (-not $Servicio) { Write-Host "Falta el nombre del modulo. Opciones: $($Modulos -join ', ')" -ForegroundColor Red; break }
    Set-Modulo $Servicio $true
  }
  'baja-todos' {
    Write-Host "Bajando los 9 modulos de negocio (uno por uno)..." -ForegroundColor Yellow
    foreach ($m in $Modulos) { Set-Modulo $m $false }
  }
  'sube-todos' {
    Write-Host "Recuperando los 9 modulos de negocio..." -ForegroundColor Green
    foreach ($m in $Modulos) { Set-Modulo $m $true }
  }
  'infra-baja' {
    if (-not $InfraMap.ContainsKey($Servicio)) { Write-Host "Infra invalida. Opciones: $($InfraMap.Keys -join ', ')" -ForegroundColor Red; break }
    Write-Host "docker stop $($InfraMap[$Servicio])" -ForegroundColor Yellow
    docker stop $InfraMap[$Servicio]
  }
  'infra-sube' {
    if (-not $InfraMap.ContainsKey($Servicio)) { Write-Host "Infra invalida. Opciones: $($InfraMap.Keys -join ', ')" -ForegroundColor Red; break }
    Write-Host "docker start $($InfraMap[$Servicio])" -ForegroundColor Green
    docker start $InfraMap[$Servicio]
  }
}
