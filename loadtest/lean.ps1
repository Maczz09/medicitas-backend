# Deja el entorno "lean" para las pruebas de carga: PARA (no borra) los
# contenedores que no se están probando, para liberar RAM/CPU del WSL2 y evitar
# que Docker Desktop se caiga bajo carga. Se pueden volver a levantar con:
#   .\lean.ps1 restore
#
# Uso:
#   .\lean.ps1 stop      # antes de correr las pruebas de carga
#   .\lean.ps1 restore   # para volver a tener todo (resiliencia con externos, etc.)

param([ValidateSet('stop','restore')][string]$Accion = 'stop')

# No se tocan: mysql, redis, rabbitmq, backend, workers, nginx (el sistema bajo
# prueba) ni la observabilidad COMPLETA de medicitas (prometheus/grafana/loki/
# promtail/JAEGER — el tracing ahora corre muestreado también en carga, así que
# Jaeger debe seguir vivo para ver las trazas de las pruebas).
# Se paran: los stacks externos (no se cargan en el test) + el frontend.
$NoEsenciales = @(
  'farmacia_api','mysql_farmacia','farmacia_autoheal',
  'aseguradora_prosalud_api','aseguradora_mysql','aseguradora_rabbitmq','aseguradora_autoheal',
  'seguros_fallback_lb','seguros_fallback_1','seguros_fallback_2','mysql_seguros_fallback',
  'medicitas_frontend'
)

if ($Accion -eq 'stop') {
  Write-Host "Parando contenedores no esenciales para liberar recursos..." -ForegroundColor Yellow
  docker stop $NoEsenciales 2>$null
  Write-Host "Listo. Corre las pruebas y luego '.\lean.ps1 restore' para recuperarlos." -ForegroundColor Green
} else {
  Write-Host "Levantando de nuevo los contenedores..." -ForegroundColor Yellow
  docker start $NoEsenciales 2>$null
  Write-Host "Listo." -ForegroundColor Green
}
