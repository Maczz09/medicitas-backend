#!/usr/bin/env bash
# Deja el entorno "lean" para las pruebas de carga: PARA (no borra) los
# contenedores que no se prueban, para liberar RAM/CPU del WSL2 y evitar que
# Docker Desktop se caiga bajo carga.
#   ./lean.sh stop      # antes de las pruebas
#   ./lean.sh restore   # para recuperar todo
set -euo pipefail

# Jaeger NO se para: el tracing corre muestreado también en carga y las trazas
# de las pruebas deben verse siempre.
NO_ESENCIALES="farmacia_api mysql_farmacia farmacia_autoheal \
aseguradora_prosalud_api aseguradora_mysql aseguradora_rabbitmq aseguradora_autoheal \
seguros_fallback_lb seguros_fallback_1 seguros_fallback_2 mysql_seguros_fallback \
medicitas_frontend"

case "${1:-stop}" in
  stop)    echo "Parando no esenciales..."; docker stop $NO_ESENCIALES 2>/dev/null || true; echo "Listo." ;;
  restore) echo "Levantando de nuevo...";   docker start $NO_ESENCIALES 2>/dev/null || true; echo "Listo." ;;
  *) echo "Uso: $0 {stop|restore}" >&2; exit 1 ;;
esac
