# Pruebas de carga y resiliencia (k6)

Prepara y ejecuta las 3 pruebas de carga que pide el profe, más los escenarios
de "dar de baja servicios" para ver la resiliencia. Todo el tuning va gateado
por env: **el `docker compose up` normal no cambia**.

## Interpretación de los niveles

"500 000 / 1 000 000 **simultáneas**" es imposible en una sola máquina (el SO no
abre tantos sockets). Se corren como **peticiones TOTALES**, midiendo throughput
(req/s), latencia p95/p99 y % de error:

| Nivel | Peticiones totales | VUs (concurrencia) por defecto |
|-------|--------------------|--------------------------------|
| 1     | 1 000              | 100                            |
| 2     | 500 000            | 300                            |
| 3     | 1 000 000          | 400                            |

## 1) Entrar en "modo carga"

```bash
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
```

Esto activa (solo mientras uses el override):
- `LOAD_TEST_MODE=true` → apaga el rate limiting (si no, k6 muere en la request 201).
- `CLUSTER_MODE=true` → N procesos Node (uno por core) en vez de 1.
- `DB_POOL_SIZE=20` por worker y `max_connections=500` en MySQL.
- `USE_MOCK_SMS=true` → sin Chromium/WhatsApp durante la carga.

Ajuste por máquina (opcional):

```bash
# Linux / Mac / Git-Bash  (sintaxis VAR=valor comando)
# Desktop 12 vCPU
WEB_CONCURRENCY=10 DB_POOL_SIZE=20 docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
# Laptop i5 (~8 hilos)
WEB_CONCURRENCY=6  DB_POOL_SIZE=20 docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
```

```powershell
# Windows PowerShell  (¡NO acepta VAR=valor en línea! usar $env:)
# Desktop 12 vCPU
$env:WEB_CONCURRENCY=10; $env:DB_POOL_SIZE=20; docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
# Laptop i5 (~8 hilos)
$env:WEB_CONCURRENCY=6;  $env:DB_POOL_SIZE=20; docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
# Limpiar las variables luego (opcional):
Remove-Item Env:WEB_CONCURRENCY, Env:DB_POOL_SIZE
```

Regla de oro: `WEB_CONCURRENCY × DB_POOL_SIZE < 500` (max_connections de MySQL).

## 2) Correr las pruebas

No hace falta instalar k6: los runners usan el contenedor `grafana/k6` dentro de
la red del stack, apuntando a `http://backend:3000` (app directo, evita el
rate-limit de nginx).

```bash
# Linux / Mac / Git-Bash
cd loadtest
./run.sh smoke      # humo (50 req) — sanity
./run.sh nivel1     # 1 000
./run.sh nivel2     # 500 000
./run.sh nivel3     # 1 000 000
```

```powershell
# Windows PowerShell
cd loadtest
.\run.ps1 smoke
.\run.ps1 nivel1
.\run.ps1 nivel2
.\run.ps1 nivel3
```

Variables útiles: `VUS`, `WRITE_RATIO` (fracción de escrituras, default 0.10).
Para pegarle por el gateway realista en vez del app directo:
`BASE_URL=http://nginx:80 ./run.sh nivel1` (ojo: nginx impone su propio
rate-limit de 30 r/s; para carga real conviene el app directo).

k6 imprime al final: `http_reqs` (throughput), `http_req_duration` (p95/p99),
`errores_5xx` (nuestro umbral: <1%).

## 3) Resiliencia — "dar de baja" servicios

Dos formas, ambas en caliente (sin reiniciar el stack). Corre la carga sostenida
y, en paralelo, baja el objetivo:

```bash
./run.sh resiliencia    # 2 min de carga; CONTROL=/medicos, OBJETIVO=/citas
```

**a) Bajar un módulo de negocio (kill-switch):** requiere token de rol Auditor.

```bash
# obtener token
TOKEN=$(curl -s -X POST http://localhost/api/v2/auth/login -H "Content-Type: application/json" \
  -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}' | jq -r .accessToken)

# bajar citas (responde 503; el resto sigue)
curl -X PATCH http://localhost/api/v2/admin/servicios/citas \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"habilitado":false}'

# reactivar
curl -X PATCH http://localhost/api/v2/admin/servicios/citas \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"habilitado":true}'
```

Módulos bajables: `pacientes, medicos, citas, seguros, pagos, historias-clinicas,
prescripciones, facturacion, notificaciones`. Con clustering el cambio se
propaga a todos los workers vía Redis.

**b) Bajar una dependencia de infra (parar contenedor):**

```bash
docker stop medicitas_rabbitmq   # la API SIGUE: los eventos se escriben a la
                                  # tabla outbox y se acumulan; al levantar Rabbit
                                  # el worker de outbox los drena.
docker stop medicitas_redis      # cae la caché de disponibilidad; degrada a BD.
docker stop farmacia_api         # abre el circuit breaker → receta de contingencia.
docker start medicitas_rabbitmq  # recuperación
```

En el resumen de k6, el tag `{kind:control}` (módulo no tocado) debe quedar
verde aunque `{kind:target}` falle — esa es la demostración.

## 4) Observar en Grafana

Con Prometheus scrapeando `/metrics` y Grafana ya provisionado
(`http://localhost:3001`), durante la carga se ven: `http_requests_total` (RPS),
`http_request_duration_seconds` (latencia), `http_request_errors_total`, y los
contadores de negocio (citas creadas, pagos, etc.). El override habilita el
`remote-write-receiver` de Prometheus por si luego quieres empujar las métricas
del propio k6.

## 5) Qué esperar (honesto)

- **Nivel 1 (1k):** pasa cómodo en desktop y laptop.
- **Niveles 2 y 3 (500k / 1M):** completables como total de peticiones a un
  throughput sostenido. Con clustering + pool + limits off, un mix mayormente de
  lecturas sostiene del orden de **miles de req/s** en el desktop; la laptop i5
  rinde ~½–⅔. Las **escrituras** (INSERT + evento outbox, serializadas por la BD)
  marcan el techo antes que las lecturas — subir `WRITE_RATIO` baja el throughput.
- El objetivo no es "1M concurrentes" (imposible en una PC), sino **medir el techo
  real, la latencia bajo carga y la degradación grácil** al caer un servicio.

## Volver a producción

```bash
docker compose up -d          # revierte el override: 1 proceso, rate limit, pool 10
```
