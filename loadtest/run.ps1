# Runner de k6 para las pruebas de carga de MediCitas (Windows PowerShell).
# Corre grafana/k6 dentro de la red del stack para alcanzar backend:3000.
#
# Uso:
#   .\run.ps1 nivel1        # 1 000 peticiones
#   .\run.ps1 nivel2        # 500 000 peticiones
#   .\run.ps1 nivel3        # 1 000 000 peticiones
#   .\run.ps1 smoke         # humo: 50 peticiones
#   .\run.ps1 resiliencia   # carga sostenida 2m (baja un servicio en paralelo)

param(
  [Parameter(Mandatory = $true)][ValidateSet('smoke','nivel1','nivel2','nivel3','escrituras','full','observabilidad','resiliencia')]
  [string]$Nivel
)

$Net     = if ($env:NET) { $env:NET } else { 'medicitas-backend_medicitas_net' }
$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { 'http://backend:3000' }
$Dir     = $PSScriptRoot

function Run-Carga($total, $vus, $wr) {
  $ratio = if ($env:WRITE_RATIO) { $env:WRITE_RATIO } else { $wr }
  docker run --rm -i --network $Net -v "${Dir}:/scripts" `
    -e BASE_URL=$BaseUrl -e TOTAL=$total -e VUS=$vus -e WRITE_RATIO=$ratio `
    grafana/k6 run /scripts/carga.js
}

# Cobertura TOTAL: toca todos los módulos (carga-full.js), taggeado por servicio.
function Run-Full($total, $vus, $wr, $mode) {
  $ratio = if ($env:WRITE_RATIO) { $env:WRITE_RATIO } else { $wr }
  $m     = if ($env:MODE) { $env:MODE } else { $mode }
  docker run --rm -i --network $Net -v "${Dir}:/scripts" `
    -e BASE_URL=$BaseUrl -e TOTAL=$total -e VUS=$vus -e WRITE_RATIO=$ratio -e MODE=$m `
    grafana/k6 run /scripts/carga-full.js
}

switch ($Nivel) {
  'smoke'  { Run-Carga 50 5 0 }
  'nivel1' { $v = if ($env:VUS) { $env:VUS } else { 100 }; Run-Carga 1000 $v 0 }
  'nivel2' { $v = if ($env:VUS) { $env:VUS } else { 150 }; Run-Carga 500000 $v 0 }
  'nivel3' { $v = if ($env:VUS) { $env:VUS } else { 150 }; Run-Carga 1000000 $v 0 }
  'escrituras' { $t = if ($env:TOTAL) { $env:TOTAL } else { 20000 }; $v = if ($env:VUS) { $env:VUS } else { 50 }; Run-Carga $t $v 1 }
  # Cobertura total en modo MIX (throughput tocando todos los módulos)
  'full' { $t = if ($env:TOTAL) { $env:TOTAL } else { 5000 }; $v = if ($env:VUS) { $env:VUS } else { 40 }; Run-Full $t $v 0.15 'mix' }
  # Observabilidad: pocas VUs + modo SWEEP (cada iteración toca los 12 servicios)
  # → trazas ricas de TODO el sistema. Correr con Jaeger arriba y OTel muestreado.
  'observabilidad' { $t = if ($env:TOTAL) { $env:TOTAL } else { 300 }; $v = if ($env:VUS) { $env:VUS } else { 8 }; Run-Full $t $v 0.30 'sweep' }
  'resiliencia' {
    $rate = if ($env:RATE) { $env:RATE } else { '100' }
    $dur  = if ($env:DURATION) { $env:DURATION } else { '2m' }
    $ctrl = if ($env:CONTROL_PATH) { $env:CONTROL_PATH } else { '/api/v2/medicos' }
    $tgt  = if ($env:TARGET_PATH) { $env:TARGET_PATH } else { '/api/v2/citas' }
    docker run --rm -i --network $Net -v "${Dir}:/scripts" `
      -e BASE_URL=$BaseUrl -e RATE=$rate -e DURATION=$dur -e CONTROL_PATH=$ctrl -e TARGET_PATH=$tgt `
      grafana/k6 run /scripts/resiliencia.js
  }
}
