#!/usr/bin/env bash
# Resiliencia servicio-por-servicio — UN comando por servicio para dar de baja
# y recuperar CADA pieza del sistema. NUNCA toca Jaeger.
#
# Uso:
#   ./resiliencia-servicios.sh estado
#   ./resiliencia-servicios.sh baja   citas
#   ./resiliencia-servicios.sh sube   citas
#   ./resiliencia-servicios.sh baja-todos
#   ./resiliencia-servicios.sh sube-todos
#   ./resiliencia-servicios.sh infra-baja  rabbitmq
#   ./resiliencia-servicios.sh infra-sube  rabbitmq
set -euo pipefail

BASE="${BASE_URL_HOST:-http://localhost}"
MODULOS=(pacientes medicos citas seguros pagos historias-clinicas prescripciones facturacion notificaciones)

# Infra (Jaeger EXCLUIDO a propósito)
declare -A INFRA=(
  [mysql]=medicitas_mysql
  [redis]=medicitas_redis
  [rabbitmq]=medicitas_rabbitmq
  [nginx]=medicitas_nginx
  [workers]=medicitas_workers
  [farmacia]=farmacia_api
  [aseguradora]=aseguradora_prosalud_api
  [seguros-fallback]=seguros_fallback_lb
)

token() {
  curl -s -X POST "$BASE/api/v2/auth/login" -H "Content-Type: application/json" \
    -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}' \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}

set_modulo() { # nombre  true|false
  local t; t=$(token)
  curl -s -X PATCH "$BASE/api/v2/admin/servicios/$1" \
    -H "Authorization: Bearer $t" -H "Content-Type: application/json" \
    -d "{\"habilitado\":$2}" >/dev/null
  echo "  $1 -> $([ "$2" = true ] && echo ARRIBA || echo 'DE BAJA (503)')"
}

case "${1:-}" in
  estado)
    t=$(token)
    echo "Estado de los modulos:"
    curl -s "$BASE/api/v2/admin/servicios" -H "Authorization: Bearer $t"; echo ;;
  baja) set_modulo "${2:?falta modulo}" false ;;
  sube) set_modulo "${2:?falta modulo}" true ;;
  baja-todos) echo "Bajando los 9 modulos..."; for m in "${MODULOS[@]}"; do set_modulo "$m" false; done ;;
  sube-todos) echo "Recuperando los 9 modulos..."; for m in "${MODULOS[@]}"; do set_modulo "$m" true; done ;;
  infra-baja) docker stop "${INFRA[${2:?falta infra}]}" ;;
  infra-sube) docker start "${INFRA[${2:?falta infra}]}" ;;
  *)
    echo "Uso: $0 {estado|baja <mod>|sube <mod>|baja-todos|sube-todos|infra-baja <inf>|infra-sube <inf>}" >&2
    echo "  modulos: ${MODULOS[*]}" >&2
    echo "  infra:   ${!INFRA[*]}" >&2
    exit 1 ;;
esac
