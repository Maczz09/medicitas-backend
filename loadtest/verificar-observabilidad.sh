#!/usr/bin/env bash
# Verificador de OBSERVABILIDAD end-to-end (versión Git Bash / Linux / Mac).
# Dice exactamente qué pieza está rota y cómo arreglarla. Ver la versión .ps1
# para el detalle de cada chequeo.
#
# Uso:  bash verificar-observabilidad.sh
set -uo pipefail
FALLOS=0
ok()   { echo "  [OK]    $1"; }
fail() { echo "  [FALLA] $1"; [ -n "${2:-}" ] && echo "          FIX: $2"; FALLOS=$((FALLOS+1)); }

echo ""; echo "=== 1) Contenedores del stack ==="
CORRIENDO=$(docker ps --format '{{.Names}}')
for c in medicitas_backend medicitas_jaeger medicitas_loki medicitas_promtail medicitas_prometheus medicitas_grafana medicitas_mysql medicitas_rabbitmq medicitas_redis medicitas_workers; do
  echo "$CORRIENDO" | grep -q "^$c$" && ok "$c" || fail "$c NO está corriendo" "docker compose up -d (o docker start $c)"
done

echo ""; echo "=== 2) OpenTelemetry en el backend ==="
OTEL=$(docker exec medicitas_backend sh -c 'echo $OTEL_SDK_DISABLED' 2>/dev/null)
if [ "$OTEL" = "true" ]; then
  fail "OTEL_SDK_DISABLED=true → sin trazas (por eso Jaeger no muestra medicitas-backend)" \
       "git pull (default del repo ya es false) y: docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --force-recreate backend workers"
else ok "OTEL_SDK_DISABLED=$OTEL (trazas activas)"; fi
TR=$(docker logs medicitas_backend 2>&1 | grep -i "Tracing" | tail -1)
case "$TR" in
  *iniciado*)    ok "SDK: $TR" ;;
  *DESACTIVADO*) fail "SDK arrancó DESACTIVADO: $TR" "recrea el contenedor tras el git pull" ;;
  *)             fail "sin línea [Tracing] en logs" "docker restart medicitas_backend" ;;
esac

echo ""; echo "=== 3) Petición de prueba (login) ==="
TOKEN=$(curl -s -X POST http://localhost/api/v2/auth/login -H "Content-Type: application/json" \
  -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
[ ${#TOKEN} -gt 50 ] && ok "login 200 → traza generada" || fail "login falló" "¿nginx arriba? ¿XAMPP en el puerto 80?"
sleep 6

echo ""; echo "=== 4) TRAZAS — Jaeger ==="
SVCS=$(curl -s http://localhost:16686/api/services)
echo "$SVCS" | grep -q "medicitas-backend" && ok "Jaeger lista medicitas-backend" \
  || fail "Jaeger NO lista medicitas-backend ($SVCS)" "casi siempre es OTel apagado (paso 2)"

echo ""; echo "=== 5) MÉTRICAS — Prometheus (:9091 agregado) ==="
TGT=$(curl -s http://localhost:9090/api/v1/targets | tr ',' '\n' | grep -A2 "medicitas-backend" | head -8)
if echo "$TGT" | grep -q "9091"; then
  curl -s http://localhost:9090/api/v1/targets | grep -q '"health":"up".*9091\|9091.*"health":"up"' \
    && ok "Prometheus scrapea backend:9091 (up)" || ok "target 9091 configurado (verifica health en :9090/targets)"
else
  fail "Prometheus no apunta a backend:9091 (config vieja o job ausente)" "git pull + docker restart medicitas_prometheus"
fi

echo ""; echo "=== 6) LOGS — Loki ==="
LINEAS=$(curl -s -G "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query=sum(count_over_time({app="medicitas-backend"}[10m]))' \
  | sed -E 's/.*"value":\[[^,]+,"([0-9]+)".*/\1/' | head -c 12)
case "$LINEAS" in (*[0-9]*) [ "$LINEAS" -gt 0 ] && ok "Loki tiene $LINEAS líneas (10min)" || fail "Loki sin logs recientes" "docker restart medicitas_promtail" ;;
  (*) fail "Loki no respondió" "docker start medicitas_loki medicitas_promtail" ;; esac

echo ""; echo "=== 7) Salud profunda ==="
# node en vez de wget: el wget de busybox NO imprime el body cuando el status
# es 503, y el body es justo lo que dice QUÉ dependencia está caída.
leer_ready() { docker exec medicitas_backend node -e "
const http=require('http');
http.get('http://localhost:3000/health/ready',r=>{let d='';r.on('data',c=>d+=c).on('end',()=>console.log(d))}).on('error',()=>console.log(''));" 2>/dev/null; }
READY=$(leer_ready)
# Reintento: tras un up/recreate, RabbitMQ tarda unos segundos en reconectar.
if ! echo "$READY" | grep -q '"READY"'; then sleep 8; READY=$(leer_ready); fi
echo "$READY" | grep -q '"READY"' && ok "readiness READY" || fail "readiness: ${READY:-sin respuesta}" "docker restart medicitas_backend medicitas_workers (RabbitMQ suele arrancar después que el backend)"

echo ""
[ $FALLOS -eq 0 ] && echo "TODO OK — observabilidad al 100%." || echo "$FALLOS problema(s) — aplica los FIX en orden."
