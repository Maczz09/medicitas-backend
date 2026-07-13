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

---

## 5) Observar resultados

- **Grafana:** http://localhost:3001 — RPS, latencia, errores, contadores de negocio.
- **k6** imprime al final: `http_reqs` (throughput), `http_req_duration` (p95/p99),
  `errores_5xx` (umbral <1%).

**Ver trazas DURANTE la carga (muestreadas 2%)** — baja el throughput ~30%,
solo para demostrar el flujo end-to-end:

> ⚠️ **`$env:VAR` solo vive en la MISMA sesión de PowerShell.** Si lo pones en
> una línea y el `docker compose up -d` en otra ejecución/terminal separada, la
> variable no llega y el backend arranca con OTel APAGADO igual (default
> `true`) — y `medicitas-backend` nunca aparecerá en el dropdown de Jaeger.
> **Todo en una sola línea, con `;`:**

```powershell
$env:OTEL_SDK_DISABLED="false"; docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d; Remove-Item Env:OTEL_SDK_DISABLED
```
```powershell
# ...corre la prueba; en Jaeger (http://localhost:16686) verás ~2% de las trazas.
# NO apliques lean sobre Jaeger si quieres esto.
```

**Verificar que sí quedó activo** (si `medicitas-backend` no aparece en el
dropdown de servicios de Jaeger, revisa esto ANTES de sospechar de otra cosa):
```powershell
docker exec medicitas_backend printenv OTEL_SDK_DISABLED     # debe decir "false"
docker logs medicitas_backend --since 2m | Select-String Tracing
#   → debe decir "OpenTelemetry iniciado — exportando a ..."
#   → si dice "OpenTelemetry DESACTIVADO", la variable no llegó: repite el
#     comando de arriba TODO en una sola línea y recrea el contenedor.
```
Jaeger solo lista un servicio **después** de recibir su primera traza — si
acabas de activar OTel, genera al menos una petición (`.\run.ps1 smoke` o un
login) antes de esperar verlo en el dropdown.

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

```
smoke → nivel1 → nivel2 → nivel3 → escrituras → resiliencia
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
