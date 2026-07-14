#!/usr/bin/env bash
# CHAOS MONKEY (versión Git Bash / Linux / Mac) — ver chaos-monkey.ps1 y
# docs/CHAOS-MONKEY.md para el plan completo.
#   ./chaos-monkey.sh [minutos] [modulos|infra]
set -uo pipefail

DURACION="${1:-5}"; NIVEL="${2:-modulos}"
BASE="${BASE_URL_HOST:-http://localhost}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$DIR/chaos-log.txt"

MODULOS=(pacientes medicos citas seguros pagos historias-clinicas prescripciones facturacion notificaciones)
declare -A INFRA=( [redis]=medicitas_redis [rabbitmq]=medicitas_rabbitmq [workers]=medicitas_workers \
  [farmacia]=farmacia_api [aseguradora]=aseguradora_prosalud_api [seguros-fallback]=seguros_fallback_lb )
TOCADOS=()

log(){ echo "$(date +%H:%M:%S) | $*" | tee -a "$LOG"; }
token(){ curl -s -X POST "$BASE/api/v2/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'; }
set_modulo(){ curl -s -X PATCH "$BASE/api/v2/admin/servicios/$1" -H "Authorization: Bearer $(token)" \
  -H "Content-Type: application/json" -d "{\"habilitado\":$2}" >/dev/null; }

restaurar(){
  log "=== RESTAURANDO TODO ==="
  for m in "${MODULOS[@]}"; do set_modulo "$m" true || true; done
  for c in "${TOCADOS[@]:-}"; do [ -n "$c" ] && docker start "$c" >/dev/null 2>&1 || true; done
  log "=== chaos terminado — todo restaurado ==="
}
trap restaurar EXIT INT TERM

: > "$LOG"
log "=== CHAOS MONKEY inicia: ${DURACION} min, nivel=$NIVEL ==="
FIN=$(( $(date +%s) + DURACION*60 ))

while [ "$(date +%s)" -lt "$FIN" ]; do
  CAIDA=$(( 10 + RANDOM % 21 ))
  if [ "$NIVEL" = "infra" ] && [ $(( RANDOM % 100 )) -lt 35 ]; then
    KEYS=("${!INFRA[@]}"); K="${KEYS[$RANDOM % ${#KEYS[@]}]}"; C="${INFRA[$K]}"
    log "CAOS: docker stop $C (caído ${CAIDA}s)"
    docker stop "$C" >/dev/null 2>&1; TOCADOS+=("$C")
    sleep "$CAIDA"
    log "RECUPERA: docker start $C"
    docker start "$C" >/dev/null 2>&1
  else
    M="${MODULOS[$RANDOM % ${#MODULOS[@]}]}"
    log "CAOS: kill-switch OFF '$M' (caído ${CAIDA}s → 503)"
    set_modulo "$M" false || true
    sleep "$CAIDA"
    log "RECUPERA: kill-switch ON '$M'"
    set_modulo "$M" true || true
  fi
  sleep $(( 15 + RANDOM % 26 ))
done
