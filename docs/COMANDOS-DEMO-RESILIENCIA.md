# Comandos para la demo de resiliencia — copiar y pegar

Guía práctica en **PowerShell** con TODOS los comandos usados y
verificados en vivo esta sesión: bajar/subir servicios, probar cada
escenario de resiliencia de punta a punta, diagnosticar, correr tests y
desplegar. Para pruebas de **carga** (k6, niveles, observabilidad) ver
[`loadtest/COMANDOS.md`](../loadtest/COMANDOS.md) — no se repite aquí.

> Todos los bloques son copiables tal cual. Ejecutar desde
> `D:\SOA\medicitas-backend` en tu terminal de **PowerShell**.

---

## 0) Credenciales de prueba

| Rol | Email | Password |
|---|---|---|
| Recepcionista | `recepcion@medicitas.pe` | `Medicitas2026!` |
| Médico | `medico@medicitas.pe` | `Medicitas2026!` |
| Auditor | `auditor@medicitas.pe` | `Medicitas2026!` |

Obtener un token (el kill-switch y el listado de pagos exigen **Auditor**;
validar cobertura y cobrar exige **Recepcionista**):

```powershell
$TOKEN_AUD = (Invoke-RestMethod -Uri "http://localhost/api/v2/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}').accessToken

$TOKEN_REC = (Invoke-RestMethod -Uri "http://localhost/api/v2/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"recepcion@medicitas.pe","password":"Medicitas2026!"}').accessToken
```

Documento de prueba con datos reales en el caché de contingencia de Seguros
(sirve para forzar el camino de fallback con un resultado real, no un
`PENDIENTE` ciego): **`12345678` → 80% aprobada** (también existe
`CE123456` → 100%).

---

## 1) Bajar / subir un módulo interno (kill-switch)

Responde **503 al instante**; el resto del sistema sigue funcionando. Rol
**Auditor**. Módulos válidos: `pacientes, medicos, citas, seguros, pagos,
historias-clinicas, prescripciones, facturacion, notificaciones`.

```powershell
# Bajar (ej. Seguros)
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios/seguros" `
  -Method Patch -Headers @{ Authorization = "Bearer $TOKEN_AUD" } `
  -ContentType "application/json" -Body '{"habilitado":false}'

# Subir
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios/seguros" `
  -Method Patch -Headers @{ Authorization = "Bearer $TOKEN_AUD" } `
  -ContentType "application/json" -Body '{"habilitado":true}'
```

Ver el estado de todos los módulos:
```powershell
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios" -Headers @{ Authorization = "Bearer $TOKEN_AUD" }
```

**Atajo con un comando por servicio** (ya armado en `loadtest/`, hace lo
mismo sin escribir la petición a mano):
```powershell
cd loadtest
.\resiliencia-servicios.ps1 estado
.\resiliencia-servicios.ps1 baja citas
.\resiliencia-servicios.ps1 sube citas
.\resiliencia-servicios.ps1 baja-todos
.\resiliencia-servicios.ps1 sube-todos
cd ..
```

---

## 2) Bajar / subir una dependencia externa real (Docker)

Para las dependencias que **no** son módulos internos (aseguradora,
farmacia, o la infra: mysql/redis/rabbitmq). Esto SÍ mata el proceso —
prueba retries + circuit breaker de verdad, no solo el kill-switch.

```powershell
# Aseguradora externa (dispara el fallback de Seguros)
docker stop aseguradora_prosalud_api
docker start aseguradora_prosalud_api

# Farmacia externa (dispara la contingencia de Prescripciones)
docker stop farmacia_api
docker start farmacia_api

# Infra — RabbitMQ (los eventos se acumulan en el outbox, no se pierden)
docker stop medicitas_rabbitmq
docker start medicitas_rabbitmq

# Ver estado de cualquier grupo
docker ps --filter name=aseguradora --format "table {{.Names}}`t{{.Status}}"
docker ps --filter name=medicitas --format "table {{.Names}}`t{{.Status}}"
```

**Atajo equivalente** (mismo script, nivel infra — nunca toca Jaeger/mysql):
```powershell
cd loadtest
.\resiliencia-servicios.ps1 infra-baja aseguradora
.\resiliencia-servicios.ps1 infra-sube aseguradora
.\resiliencia-servicios.ps1 infra-baja farmacia
.\resiliencia-servicios.ps1 infra-sube farmacia
cd ..
```

---

## 3) Escenario A — Aseguradora caída → fallback → reconciliación automática (Seguros)

Reproduce exactamente la demo: valida cobertura con la aseguradora abajo
(responde con el caché, marcado `esFallback:true`), la levanta, y confirma
que se corrige **sola** (sin recargar el frontend) en el próximo ciclo.

```powershell
# 1. Buscar el paciente de prueba
$PAC_RES = Invoke-RestMethod -Uri "http://localhost/api/v2/pacientes?q=12345678&limit=1" -Headers @{ Authorization = "Bearer $TOKEN_REC" }
$PAC = if ($PAC_RES.data) { $PAC_RES.data[0].id_paciente } else { $PAC_RES[0].id_paciente }
Write-Host "paciente: $PAC"

# 2. Bajar la aseguradora
docker stop aseguradora_prosalud_api

# 3. Validar cobertura → debe responder APROBADA/80% con esFallback:true
$BODY_VAL = @{ idPaciente=$PAC; idAseguradora="ASEG-PROSALUD"; numeroPoliza="12345678"; tipoConsulta="CONSULTA_GENERAL" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost/api/v2/coberturas/validar" `
  -Method Post -Headers @{ Authorization = "Bearer $TOKEN_REC"; "Idempotency-Key" = (Get-Date).Ticks.ToString() } `
  -ContentType "application/json" -Body $BODY_VAL

# copiar el "idValidacion" de la respuesta ↓
$COB="<pegar-idValidacion-aquí>"

# 4. Levantar la aseguradora
docker start aseguradora_prosalud_api

# 5. Esperar el backstop (≤60s) y confirmar que ya NO es fallback
Start-Sleep -Seconds 65
Invoke-RestMethod -Uri "http://localhost/api/v2/coberturas/$COB" -Headers @{ Authorization = "Bearer $TOKEN_REC" }
# esFallback debe ser ahora `false`
```

Mientras tanto, con `ValidarCoberturaPage` abierta en el navegador
(recepción → Cobertura), el resultado se corrige solo en pantalla y sale un
toast de confirmación — no hace falta el paso 5 manual, es solo para
verificar por API sin el navegador.

---

## 4) Escenario B — Seguros caído durante un cobro → reconciliación automática (Pagos)

Un pago se confirma **sin bloquear el cobro** aunque Seguros esté caído; al
recuperarse, se re-verifica solo y el badge ⚠️ desaparece en
`AdminPagosPage` (Auditor) sin recargar.

```powershell
# 1. Validar una cobertura real primero (con Seguros arriba) para tener un
#    idValidacion + código de autorización legítimos
$BODY_COB = @{ idPaciente=$PAC; idAseguradora="ASEG-PROSALUD"; numeroPoliza="12345678"; tipoConsulta="CONSULTA_GENERAL" } | ConvertTo-Json
$COB_JSON = Invoke-RestMethod -Uri "http://localhost/api/v2/coberturas/validar" `
  -Method Post -Headers @{ Authorization = "Bearer $TOKEN_REC"; "Idempotency-Key" = (Get-Date).Ticks.ToString() } `
  -ContentType "application/json" -Body $BODY_COB

$COB = $COB_JSON.idValidacion
$AUT = $COB_JSON.codigoAutorizacion
Write-Host "cobertura: $COB / autorización: $AUT"

# 2. Reservar una cita cobrable (médico + slot libre)
$MED_RES = Invoke-RestMethod -Uri "http://localhost/api/v2/medicos?limit=1" -Headers @{ Authorization = "Bearer $TOKEN_REC" }
$MED = if ($MED_RES.data) { $MED_RES.data[0].id_medico } else { $MED_RES[0].id_medico }
$FECHA = (Get-Date).AddDays(2).ToString("yyyy-MM-dd")

$BODY_CITA = @{ idPaciente=$PAC; idMedico=$MED; fechaHora="${FECHA}T08:00:00"; especialidad="Especialidad Run 5" } | ConvertTo-Json
$CITA_JSON = Invoke-RestMethod -Uri "http://localhost/api/v2/citas" `
  -Method Post -Headers @{ Authorization = "Bearer $TOKEN_REC"; "Idempotency-Key" = (Get-Date).Ticks.ToString() } `
  -ContentType "application/json" -Body $BODY_CITA

$CITA = $CITA_JSON.idCita
Write-Host "cita: $CITA"

# 3. Bajar Seguros por kill-switch
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios/seguros" `
  -Method Patch -Headers @{ Authorization = "Bearer $TOKEN_AUD" } `
  -ContentType "application/json" -Body '{"habilitado":false}'

# 4. Cobrar igual — debe responder 200 con coberturaVerificada:false
$BODY_PAGO = @{
    idCita = $CITA
    idPaciente = $PAC
    metodoPago = "EFECTIVO"
    montoTotal = 100
    montoCubiertoSeguro = 80
    montoCopago = 20
    tipoComprobante = "BOLETA"
    idValidacionCobertura = $COB
    codigoAutorizacionSeguro = $AUT
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost/api/v2/pagos" `
  -Method Post -Headers @{ Authorization = "Bearer $TOKEN_REC"; "Idempotency-Key" = (Get-Date).Ticks.ToString() } `
  -ContentType "application/json" -Body $BODY_PAGO

# guardar el "idPago" de la respuesta ↓
$PAGO="<pegar-idPago-aquí>"

# 5. Levantar Seguros
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios/seguros" `
  -Method Patch -Headers @{ Authorization = "Bearer $TOKEN_AUD" } `
  -ContentType "application/json" -Body '{"habilitado":true}'

# 6. Esperar el backstop de pagos (cada 15s) y confirmar
Start-Sleep -Seconds 20
Invoke-RestMethod -Uri "http://localhost/api/v2/pagos?limit=5" -Headers @{ Authorization = "Bearer $TOKEN_AUD" } | ConvertTo-Json -Depth 10 | Select-String -Pattern "`"id_pago`":\s*`"$PAGO`".*?`"cobertura_verificada`":\s*(1|true)"
# cobertura_verificada debe ser 1 (o true)
```

Con `AdminPagosPage` abierta como Auditor, el ícono ⚠️ junto al pago
desaparece solo en ese mismo momento.

---

## 5) Diagnóstico rápido

```powershell
$PW = (Select-String -Path .env -Pattern 'MYSQL_ROOT_PASSWORD=(.*)').Matches.Groups[1].Value

# Estado real en BD (evita depender de logs)
docker exec medicitas_mysql mysql -uroot -p"$PW" -e "SELECT id, estado_cobertura, es_fallback FROM svc_seg.validaciones_cobertura WHERE id='$COB';" | Select-String -NotMatch "Warning"

docker exec medicitas_mysql mysql -uroot -p"$PW" -e "SELECT id_pago, cobertura_verificada FROM svc_pag.pagos WHERE id_pago='$PAGO';" | Select-String -NotMatch "Warning"

# Backlog de reconciliación pendiente (por si hay mucho, tarda más)
docker exec medicitas_mysql mysql -uroot -p"$PW" -e "SELECT COUNT(*) FROM svc_seg.validaciones_cobertura WHERE estado_cobertura='PENDIENTE' OR es_fallback=1;" | Select-String -NotMatch "Warning"

# Colas de RabbitMQ (profundidad + argumentos DLX)
docker exec medicitas_rabbitmq rabbitmqctl list_queues -p medicitas name messages durable
docker exec medicitas_rabbitmq rabbitmqctl list_queues -p medicitas name durable arguments

# Logs filtrados en vivo
docker logs medicitas_backend --since 2m 2>&1 | Select-String -Pattern "(?i)seguros|cobertura"
docker logs medicitas_backend --since 2m 2>&1 | Select-String -Pattern "(?i)pagos\].*reverific|PagoCobertura"
docker logs medicitas_workers --tail 30    # worker de outbox (drena a RabbitMQ cada 5s)

# Salud general — el contenedor reporta su propio HEALTHCHECK
docker ps --filter name=medicitas_backend --format "{{.Status}}"
# /health/ready NO pasa por nginx (solo /api/ está proxeado) — se consulta
# directo dentro del contenedor, igual que lo hace el HEALTHCHECK de Docker:
docker exec medicitas_backend wget -qO- http://localhost:3000/health/ready
```

---

## 6) Correr los tests del backend

```powershell
npm test                                              # suite completa
npx jest tests/unit/pagos/ConfirmarPagoUseCase.test.js  # un archivo puntual
npx jest tests/unit/seguros                            # una carpeta
```
> Si falla solo `AseguradoraAxiosAdapter.test.js` con timeout y el resto
> pasa: es un flake de timing conocido (corre solo y pasa en 2-3s). No es
> una regresión — reintentar `npm test` una vez.

---

## 7) ⚠️ Reconstruir y desplegar tras un cambio de código

**El error más caro de esta sesión, dos veces:** cambiar código y probar en
`:8081` sin reconstruir la imagen — el navegador sigue con el bundle
viejo en memoria y parece que "no funcionó" cuando en realidad nunca se
desplegó. Después de tocar código:

```powershell
# Backend
docker compose build backend
docker compose up -d backend

# Frontend
docker compose build frontend
docker compose up -d frontend

# Los dos juntos
docker compose build backend frontend
docker compose up -d backend frontend
```

Esperar a que el backend reporte `healthy` antes de probar:
```powershell
while ((docker inspect -f '{{.State.Health.Status}}' medicitas_backend 2>$null) -ne "healthy") { Start-Sleep -Seconds 3 }
Write-Host "LISTO"
```

Si además tocaste el frontend, **cierra la pestaña vieja del navegador y
abre una nueva** (o hard refresh `Ctrl+Shift+R`) — `index.html` no se
cachea, pero una pestaña ya cargada no se entera sola de un rebuild.

---

## 8) Volver todo a la normalidad al terminar

```powershell
# Confirmar que los 9 módulos y las dependencias externas quedaron arriba
Invoke-RestMethod -Uri "http://localhost/api/v2/admin/servicios" -Headers @{ Authorization = "Bearer $TOKEN_AUD" }
docker ps --filter name=medicitas --format "table {{.Names}}`t{{.Status}}"
docker ps --filter name=aseguradora --format "table {{.Names}}`t{{.Status}}"

# Si algo quedó abajo
cd loadtest
.\resiliencia-servicios.ps1 sube-todos
cd ..
docker start aseguradora_prosalud_api medicitas_rabbitmq 2>$null
```

---

## Dashboards para tener abiertos durante la demo

| Qué | URL |
|---|---|
| Frontend | http://localhost:8081 |
| Grafana (métricas + contadores de negocio) | http://localhost:3001 |
| Jaeger (trazas end-to-end) | http://localhost:16686 |
| RabbitMQ management (colas, DLQ) | http://localhost:15672 |
| Prometheus | http://localhost:9090 |

Ver [`docs/CHAOS-MONKEY.md`](CHAOS-MONKEY.md) para los criterios de éxito
que se le muestran al profe (aislamiento, sin pérdida de eventos,
recuperación automática, trazabilidad) y [`docs/MANEJO-ERRORES.md`](MANEJO-ERRORES.md)
para el catálogo de códigos de error si el profe prueba casos raros.
