#!/usr/bin/env bash
# Runner de k6 para las pruebas de carga de MediCitas (Linux/Mac/Git-Bash).
# Corre el contenedor grafana/k6 dentro de la red del stack para alcanzar
# backend:3000 (app directo, evita el rate-limit de nginx).
#
# Uso:
#   ./run.sh nivel1        # 1 000 peticiones
#   ./run.sh nivel2        # 500 000 peticiones
#   ./run.sh nivel3        # 1 000 000 peticiones
#   ./run.sh smoke         # humo: 50 peticiones
#   ./run.sh resiliencia   # carga sostenida 2m (baja un servicio en paralelo)
#
# Variables opcionales: NET, BASE_URL, VUS, WRITE_RATIO
set -euo pipefail

NET="${NET:-medicitas-backend_medicitas_net}"
BASE_URL="${BASE_URL:-http://backend:3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run() { # script total vus
  docker run --rm -i --network "$NET" \
    -v "$DIR:/scripts" \
    -e BASE_URL="$BASE_URL" -e TOTAL="$2" -e VUS="$3" -e WRITE_RATIO="${WRITE_RATIO:-0.10}" \
    grafana/k6 run "/scripts/$1"
}

case "${1:-}" in
  smoke)       run carga.js 50 5 ;;
  nivel1)      run carga.js 1000 "${VUS:-100}" ;;
  nivel2)      run carga.js 500000 "${VUS:-300}" ;;
  nivel3)      run carga.js 1000000 "${VUS:-400}" ;;
  resiliencia)
    docker run --rm -i --network "$NET" -v "$DIR:/scripts" \
      -e BASE_URL="$BASE_URL" -e RATE="${RATE:-100}" -e DURATION="${DURATION:-2m}" \
      -e CONTROL_PATH="${CONTROL_PATH:-/api/v2/medicos}" -e TARGET_PATH="${TARGET_PATH:-/api/v2/citas}" \
      grafana/k6 run /scripts/resiliencia.js ;;
  *)
    echo "Uso: $0 {smoke|nivel1|nivel2|nivel3|resiliencia}" >&2; exit 1 ;;
esac
