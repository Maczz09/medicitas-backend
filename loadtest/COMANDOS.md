# Comandos de pruebas de carga (k6) — guía rápida por máquina

Guía copiable de todos los comandos para correr las pruebas de peticiones, con
el tuning para las dos máquinas del proyecto. Para el detalle de qué mide cada
prueba, ver [README.md](README.md).

| Máquina | Specs | `.wslconfig` | Modo carga | Lean |
|---|---|---|---|---|
| **Desktop** | 32GB, Ryzen 5 5600X (6c/12t) | 20GB / 10 proc | defaults (6×8) | opcional |
| **Laptop**  | 16GB, i5 10ª (≈4c/8t) | 10GB / 6 proc | `WEB_CONCURRENCY=4; DB_POOL_SIZE=8` | **sí, antes de nivel 2/3** |

Regla de oro del pool: `WEB_CONCURRENCY × DB_POOL_SIZE` ≈ 3-4× núcleos y siempre `< 500`.

---

## 0) Preparación (una sola vez por máquina)

**Permitir ejecutar los `.ps1`** (solo en la sesión actual):
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

**Darle memoria a WSL2** — edita `C:\Users\<tu-usuario>\.wslconfig`:

Desktop (32GB):
```ini
[wsl2]
memory=20GB
processors=10
swap=8GB
```
Laptop (16GB):
```ini
[wsl2]
memory=10GB
processors=6
swap=8GB
```

Aplica el cambio (cierra Docker; reinicia WSL; vuelve a abrir Docker Desktop):
```powershell
wsl --shutdown
```
> Sin este límite WSL2 se satura y Docker Desktop se cae bajo carga.

---

## 1) Entrar en modo carga

**Desktop** (defaults 6×8, perfectos para 6c/12t):
```powershell
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
```

**Laptop** (baja a 4×8 para no ahogar MySQL con 4 núcleos):
```powershell
$env:WEB_CONCURRENCY=4; $env:DB_POOL_SIZE=8
docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d
Remove-Item Env:WEB_CONCURRENCY, Env:DB_POOL_SIZE
```
> Activa LOAD_TEST_MODE (apaga rate-limit), CLUSTER_MODE (varios procesos Node),
> max_connections=500, USE_MOCK_SMS (sin Chromium) y apaga OpenTelemetry (máx
> throughput). El `docker compose up` normal NO cambia.

---

## 2) (Recomendado en laptop) Modo lean para liberar RAM

```powershell
cd loadtest
.\lean.ps1 stop      # antes de las pruebas
.\lean.ps1 restore   # para recuperar externos/Jaeger/frontend (resiliencia los necesita)
```
> Para (no borra) stacks externos + Jaeger + frontend. Opcional en desktop,
> casi obligatorio en la laptop para niveles 2 y 3.

---

## 3) Correr las pruebas (desde `loadtest/`)

```powershell
cd loadtest

.\run.ps1 smoke        # 50 peticiones — sanity, empieza SIEMPRE por aquí
.\run.ps1 nivel1       # 1 000     lecturas
.\run.ps1 nivel2       # 500 000   lecturas
.\run.ps1 nivel3       # 1 000 000 lecturas
.\run.ps1 escrituras   # 20 000 creaciones (INSERT + evento outbox → consumer)
```

Los niveles son **peticiones totales** (no simultáneas): miden throughput (req/s)
y latencia p95/p99. La prueba de **escrituras** estresa el camino outbox/trazas.

**Ajustar concurrencia (VUs):**
```powershell
# Desktop: exprimir más
$env:VUS=200; .\run.ps1 nivel2; Remove-Item Env:VUS

# Laptop: bajar para no saturar
$env:VUS=80;  .\run.ps1 nivel2; Remove-Item Env:VUS
```

**Escrituras con total personalizado:**
```powershell
$env:TOTAL=5000; .\run.ps1 escrituras; Remove-Item Env:TOTAL
```

### 3.1) Cobertura TOTAL — tocar TODOS los módulos (para observabilidad)

`carga.js` solo golpea unos endpoints. Para que en Jaeger/Grafana/Loki aparezcan
los **12 servicios** (pacientes, medicos, citas, seguros, pagos, historias,
prescripciones, facturacion, auditoria, notificaciones, admin + externos), usa
`carga-full.js` vía estos targets:

```powershell
# MODO SWEEP: cada iteración toca UN endpoint de CADA módulo → garantiza trazas
# de los 12 servicios. Pocas VUs, ideal para la demo de observabilidad.
.\run.ps1 observabilidad          # 300 iters, 8 VUs, 30% escrituras

# MODO MIX: mezcla ponderada, mide throughput tocando todos los módulos.
.\run.ps1 full                    # 5000 iters, 40 VUs, 15% escrituras
$env:TOTAL=20000; $env:VUS=50; .\run.ps1 full; Remove-Item Env:TOTAL,Env:VUS
```

La **cascada de escritura** (paciente → validar cobertura → cita → pago) genera
UNA traza que cruza pacientes → seguros → citas → pagos → **facturación
(comprobante+PDF)** → **notificaciones (SMS)** → auditoría. El resumen de k6
imprime `cascadas_completas` = cuántas cadenas full-stack se completaron.

### 3.2) FLUJO CLÍNICO COMPLETO — la "traza reina" (1 comando)

Los flujos de HCL y farmacia exigen cita de HOY + En_Atencion, así que la carga
masiva no los cubre. Este script ejecuta UNA vez el viaje entero y te deja los
correlationIds para buscarlo en Jaeger/Loki:

```powershell
bash loadtest/flujo-clinico.sh     # funciona igual en PowerShell (invoca Git Bash)
```
Pasos que ejecuta: paciente → expediente → cobertura (aseguradora) → cita HOY →
ingreso (En_Atencion) → pago (→ comprobante+PDF + SMS) → **encuentro clínico con
prescripción** (→ PrescripcionEmitida → despacho → **farmacia-api**) → verifica
el despacho DESPACHADA y la auditoría del correlationId. Si el médico no tiene
agenda a esa hora, define un horario de semana para HOY y sigue — corre a
cualquier hora.

---

## 4) Resiliencia — dar de baja un servicio

Necesita los externos → primero `.\lean.ps1 restore` si estabas en lean.

**Terminal 1 — carga sostenida 2 min:**
```powershell
.\run.ps1 resiliencia
```

**Terminal 2 (mientras corre) — bajar un módulo (kill-switch):**
```powershell
$TOKEN = (Invoke-RestMethod -Method Post -Uri http://localhost/api/v2/auth/login `
  -ContentType 'application/json' `
  -Body '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}').accessToken

# bajar citas (responde 503; el resto sigue)
Invoke-RestMethod -Method Patch -Uri http://localhost/api/v2/admin/servicios/citas `
  -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType 'application/json' `
  -Body '{"habilitado":false}'

# reactivar
Invoke-RestMethod -Method Patch -Uri http://localhost/api/v2/admin/servicios/citas `
  -Headers @{ Authorization = "Bearer $TOKEN" } -ContentType 'application/json' `
  -Body '{"habilitado":true}'
```

**O bajar infra** (la API sigue; los eventos se acumulan en el outbox):
```powershell
docker stop medicitas_rabbitmq
docker start medicitas_rabbitmq   # al volver, el worker de outbox los drena
```

Módulos bajables por kill-switch: `pacientes, medicos, citas, seguros, pagos,
historias-clinicas, prescripciones, facturacion, notificaciones`.

### 4.1) Resiliencia servicio-por-servicio (un comando por servicio)

Script dedicado con UN comando para bajar/recuperar CADA pieza. **Nunca toca
Jaeger** (para no perder trazas durante la prueba).

```powershell
.\resiliencia-servicios.ps1 estado                  # ver qué módulos están arriba

# --- MÓDULOS de negocio (kill-switch, 503 pero el resto sigue) ---
.\resiliencia-servicios.ps1 baja citas              # bajar UNO
.\resiliencia-servicios.ps1 sube citas              # recuperarlo
.\resiliencia-servicios.ps1 baja-todos              # bajar los 9, uno por uno
.\resiliencia-servicios.ps1 sube-todos              # recuperar los 9

# --- INFRA (docker stop; demuestra reintentos / circuit breaker / outbox) ---
.\resiliencia-servicios.ps1 infra-baja rabbitmq     # eventos se acumulan en outbox
.\resiliencia-servicios.ps1 infra-sube rabbitmq     # el worker los drena al volver
.\resiliencia-servicios.ps1 infra-baja farmacia     # abre circuit breaker → receta contingencia
.\resiliencia-servicios.ps1 infra-sube farmacia
```

Infra bajable: `mysql, redis, rabbitmq, nginx, workers, farmacia, aseguradora,
seguros-fallback`. (En Git Bash: `bash resiliencia-servicios.sh <accion> <servicio>`.)

**Demostración típica para el profe:** en una terminal corre `.\run.ps1 full`
(carga sostenida tocando todo); en otra, baja un servicio y muestra que el
resto sigue verde en Grafana y que las trazas del módulo caído desaparecen en
Jaeger. Luego recupéralo y muestra que vuelve.

### 4.2) CHAOS MONKEY — fallos aleatorios bajo carga (plan: docs/CHAOS-MONKEY.md)

Tumba servicios AL AZAR (10-30 s cada uno) mientras el sistema está bajo carga,
lo deja todo en `chaos-log.txt` con timestamps y SIEMPRE restaura al final:

```powershell
# T1: carga sostenida            # T2: el mono suelto
.\run.ps1 full                    .\chaos-monkey.ps1                       # 5 min, solo módulos (503 limpio)
                                  .\chaos-monkey.ps1 -Duracion 10 -Nivel infra  # + redis/rabbit/farmacia/...
# Git Bash: ./chaos-monkey.sh 10 infra
```
Nunca toca mysql, nginx ni la observabilidad. Los criterios de éxito y qué
métricas mirar están en [docs/CHAOS-MONKEY.md](../docs/CHAOS-MONKEY.md).

---

## 5) Observar resultados

- **Grafana:** http://localhost:3001 — RPS, latencia, errores, contadores de negocio.
- **k6** imprime al final: `http_reqs` (throughput), `http_req_duration` (p95/p99),
  `errores_5xx` (umbral <1%).

**Trazas DURANTE la carga: AHORA VIENEN ACTIVAS POR DEFECTO** (desde el commit
que cambió `docker-compose.loadtest.yml`): OTel corre SIEMPRE, muestreado al
**10%** en modo carga y al 100% en modo normal. Ya NO hay que setear ninguna
variable — cualquier máquina que haga `git pull` + `up -d` ve las trazas.

Solo si quieres el máximo throughput absoluto para pasar un nivel (cuesta ~30%
tenerlo encendido), apágalo explícito en UNA sola línea:
```powershell
$env:OTEL_SDK_DISABLED="true"; docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d; Remove-Item Env:OTEL_SDK_DISABLED
```
> ⚠️ `$env:VAR` solo vive en la MISMA sesión de PowerShell — la variable y el
> `up -d` deben ir en la misma línea, con `;`.

### ⭐ "No veo las trazas / los logs" (laptop u otra máquina) — diagnóstico en 1 comando

```powershell
cd loadtest
.\verificar-observabilidad.ps1        # PowerShell
bash verificar-observabilidad.sh      # Git Bash
```
Chequea las 7 piezas (contenedores, OTel, Jaeger, Prometheus :9091, Loki,
readiness), genera una traza de prueba, y por cada fallo te imprime el **FIX**
exacto. Causas típicas tras un `git pull`:
1. El contenedor viejo sigue con `OTEL_SDK_DISABLED=true` → hay que
   **recrearlo**: `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --force-recreate backend workers`
   (un simple `restart` NO relee las variables del compose).
2. Prometheus con config vieja (scrapeando :3000 en vez de :9091) →
   `docker restart medicitas_prometheus`.
3. Jaeger solo lista un servicio tras recibir su PRIMERA traza → genera una
   petición (`.\run.ps1 smoke`) antes de buscarlo en el dropdown.

---

## 5.1) Observabilidad al 100% — los 3 pilares en tiempo real

Setup recomendado para la demo (carga SIN rate-limit + trazas visibles, Jaeger
vivo). Todo en una línea:
```powershell
$env:OTEL_SDK_DISABLED="false"; docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d; Remove-Item Env:OTEL_SDK_DISABLED
```
Luego deja corriendo carga que toca todo: `.\run.ps1 full` o `.\run.ps1 observabilidad`.

### A) TRAZAS — Jaeger (http://localhost:16686)
- **Service** = `medicitas-backend`, **Operation** = `POST /api/v2/pagos` → **Find Traces**.
- Abre una traza de pago: verás **una sola cascada** que cruza pagos → factura
  (comprobante) → notificaciones (SMS) → auditoría, unida por el `traceparent`
  propagado por el outbox. Es la trazabilidad end-to-end.
- También aparecen `aseguradora-api` y `farmacia-api` (servicios externos) en las
  cascadas de cobertura y prescripción.
- Buscar TODO un flujo: pon en **Tags** `correlationId=<id>` (el id sale en la
  respuesta JSON de cualquier POST).

### B) MÉTRICAS — Grafana (http://localhost:3001) / Prometheus (http://localhost:9090)
- Grafana ya está provisionado: RPS, latencia p95/p99, errores y **contadores de
  negocio**: citas creadas, pagos, comprobantes, SMS, coberturas, encuentros.
- Prometheus scrapea `backend:9091` (NO 3000). En modo cluster el proceso primary
  **agrega** las métricas de los N workers ahí — si scrapeara 3000 vería solo un
  worker al azar y los contadores saldrían en 0. Ver `src/config/metricsServer.js`.
- Consulta rápida (PromQL en Prometheus): `sum(medicitas_pagos_completados_total)`,
  `sum(rate(http_requests_total[1m]))` (RPS), `histogram_quantile(0.95,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` (p95).

### C) LOGS — Loki (en Grafana → Explore → datasource Loki)
- Todas las peticiones + eventos, correlacionables:
  ```logql
  {app="medicitas-backend"} | json | correlationId=`<id>`
  ```
- Un correlationId te da la petición HTTP + los eventos del outbox + el
  procesamiento en los consumers, a través de todos los servicios.

> **Nota honesta de rendimiento:** con OTel encendido el throughput baja ~30%
> (medido en el desktop 5600X: ~356 req/s con OTel vs ~500+ sin él). Para
> "pasar los niveles" al máximo, corre sin OTel; para DEMOSTRAR observabilidad,
> enciéndelo. Ambos escenarios dan 0% de errores 5xx.

---

## 6) Volver a la normalidad

```powershell
cd loadtest
.\lean.ps1 restore     # si usaste lean
cd ..
docker compose up -d   # revierte el override: 1 proceso, rate-limit, pool 10
```

---

## Flujo típico recomendado

**Para medir throughput (techo de req/s):**
```
smoke → nivel1 → nivel2 → nivel3 → escrituras
```
**Para la demo de observabilidad/trazabilidad (profe):**
```
levantar con OTEL_SDK_DISABLED=false  →  .\run.ps1 full (o observabilidad)
→  ver Jaeger + Grafana + Loki  →  resiliencia-servicios (bajar/subir servicios)
```
Desktop con defaults; laptop con lean + `$env:VUS=80` en los niveles altos.

---

## Nota para Git Bash (en vez de PowerShell)

Los runners `.sh` existen (`./run.sh smoke`, `./lean.sh stop`), pero en Git Bash
hay que anteponer `MSYS_NO_PATHCONV=1`, si no Git Bash rompe la ruta `/scripts/`
del contenedor k6:
```bash
MSYS_NO_PATHCONV=1 ./run.sh smoke
```
