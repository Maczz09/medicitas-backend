# Versionado del ecosistema MediCitas: v1 → v2

Este documento registra la decisión de versionado tomada para el ecosistema MediCitas (`medicitas-backend`, `farmacia-api`, `aseguradora-prosalud-api`, `medicitas-frontend`), aplicando el framework de gobierno de contratos de API acordado con el equipo. Es el registro de auditoría de **por qué** se pasó a v2, **qué** cambió, y **cómo se clasificó** cada cambio.

## Corte temporal

| Versión | Rango | Repos afectados |
|---|---|---|
| **v1** | Hasta 2026-07-01 (inclusive) | Los 4 |
| **v2** | 2026-07-03 → 2026-07-07 (hoy) | Los 4 |

El corte se fijó en **2026-07-03** porque es la fecha del primer commit de esta ventana en los 4 repos — una sesión de trabajo nocturna (madrugada del 03) que introdujo tracing distribuido, logging dual y un cambio de contrato en los webhooks (ver §3.1). Todo el trabajo posterior, incluida la auditoría completa de producción de hoy (2026-07-07), se acumula sobre esa misma base sin que haya habido un release intermedio — por eso ambas ventanas se agrupan en una sola v2.

---

## 1. Por qué v2 y no solo parches sobre v1

Aplicando la política de compatibilidad hacia atrás acordada:

> "Un cambio se considera compatible hacia atrás si los consumidores actuales pueden seguir funcionando sin modificar absolutamente nada en su código."

Tres cambios en esta ventana **no cumplen ese criterio** — son *breaking changes* según las reglas explícitas del framework:

| # | Cambio | Regla del framework que viola mantenerlo en v1 |
|---|---|---|
| 1 | Webhooks salientes de farmacia-api/aseguradora-api cambiaron de header/clave de autenticación | Cambia el mecanismo de autenticación del contrato — un consumidor que siguiera usando el header/clave viejos empieza a recibir 401 |
| 2 | `Idempotency-Key` pasó de opcional a **obligatoria** en `POST /citas` y `POST /pagos` | "No debes agregar campos obligatorios en el request sin lanzar una nueva versión de la API" — aplica igual a un header obligatorio que a un campo del body: el mismo request que antes devolvía 201 ahora devuelve 400 |
| 3 | Envelope de error unificado en los 3 backends (`{codigo, mensaje, detalles, correlationId, timestamp}`) reemplaza formas ad-hoc previas | "No debes cambiar los códigos de error sin antes revisar a los consumidores, pues rompe su manejo de fallas" — cualquier código que leyera `err.error` o `err.motivo` (forma antigua de farmacia-api en sus 400) deja de encontrar ese campo |

Con al menos un breaking change confirmado, la política es categórica: **no crear un endpoint nuevo cambiando el nombre de la ruta** (práctica prohibida) y **sí versionar** formalmente. Se eligió **v2 para todo el ecosistema** (no solo para los 3 endpoints puntuales) porque los cambios 1 y 3 son transversales — no están acotados a un endpoint, sino al contrato de error/autenticación completo de cada servicio — y mezclar "algunos endpoints en v1, otros en v2" habría sido más confuso que consistente.

---

## 2. Estrategia de versionado elegida

**Versión en la URL** (`/api/v1/...` → `/api/v2/...` cuando aplique), por ser la estrategia ya establecida de facto en los 3 backends (todos los endpoints actuales ya viven bajo `/api/v1/`) y la más simple/visible de las tres opciones aceptadas.

**Estado de implementación actual**: este documento formaliza el corte v1/v2 **a nivel de changelog y número de versión** (`package.json`, Swagger `info.version` → `2.0.0` en los 3 backends). **No** se desdobló la URL en `/api/v2/` todavía — los 3 breaking changes de la tabla anterior ya están desplegados como la única versión activa, y los 4 consumidores del ecosistema (los propios repos, todos bajo control directo) ya fueron actualizados en el mismo movimiento. No existe hoy un consumidor externo desconocido corriendo contra la forma vieja del contrato.

Esto es una desviación consciente del proceso ideal (ver §5, "Nota de gobierno") — se documenta explícitamente en vez de ocultarla.

---

## 3. Inventario de breaking changes (checklist de gobierno completo)

### 3.1 — Autenticación de webhooks salientes (farmacia-api, aseguradora-prosalud-api) — commits `0259ebb` / `f729752`, 2026-07-03

| Pregunta | Respuesta |
|---|---|
| **Qué cambia** | El webhook que `farmacia-api`/`aseguradora-prosalud-api` disparan hacia MediCitas al cambiar el estado de una receta/póliza dejó de usar el header `x-api-key` con el valor hardcodeado `'test-api-key-12345'`, y pasó a usar `X-Webhook-Api-Key` con `FARMACIA_API_KEY`/`ASEGURADORA_API_KEY` (el mismo secreto compartido que ya se usaba en sentido inverso) |
| **Por qué cambia** | MediCitas había endurecido su verificación de webhooks entrantes (constant-time compare, fail-closed) y empezó a rechazar con 401 el header/clave viejos — este cambio es la corrección correspondiente del lado emisor |
| **A quién afecta** | Único consumidor: `medicitas-backend` (receptor de los webhooks). No hay terceros externos suscritos a estos webhooks |
| **Es compatible** | No — cambia el header y el valor de autenticación |
| **Requiere nueva versión** | Sí, según la regla de "no cambiar mecanismo de autenticación sin avisar" |
| **Cómo se comunicó** | Desplegado en conjunto con el endurecimiento del receptor en el mismo commit de esa noche — no hubo ventana de aviso previa (ver nota de gobierno, §5) |
| **Cómo se prueba** | Verificado en esta sesión: `curl` sin `X-Webhook-Api-Key` → 401 en ambos webhooks; con la clave correcta → 200 y efecto en base de datos confirmado |

### 3.2 — `Idempotency-Key` obligatoria en `POST /citas` y `POST /pagos` (medicitas-backend + medicitas-frontend) — 2026-07-07

| Pregunta | Respuesta |
|---|---|
| **Qué cambia** | Ambos endpoints ahora exigen el header `Idempotency-Key`; su ausencia devuelve `400 IDEMPOTENCY_KEY_REQUERIDA` en vez de procesar la petición |
| **Por qué cambia** | Son las dos operaciones del sistema con efectos de negocio más caros de deshacer (bloquear un slot de agenda, registrar un cobro) — un doble clic o un reintento de red no debe poder duplicarlas. Antes el header era soportado pero opcional |
| **A quién afecta** | `medicitas-frontend` (único consumidor conocido de estos dos endpoints) |
| **Es compatible** | No — una petición que antes devolvía 201 sin el header ahora devuelve 400 |
| **Requiere nueva versión** | Sí — coincide textualmente con la regla "no debes agregar campos obligatorios en el request sin lanzar una nueva versión de la API" |
| **Cómo se comunicó** | El único consumidor (`medicitas-frontend`) se actualizó en el mismo commit/sesión para generar la clave con `crypto.randomUUID()` — coordinación directa, no aviso a terceros porque no los hay |
| **Cómo se prueba** | Verificado en esta sesión: petición sin header → 400 con el código exacto; con header → 201; reintento con la misma clave → misma respuesta cacheada (mismo `idCita`, mismo `correlationId`), sin duplicar |

### 3.3 — Envelope de error unificado en los 3 backends — 2026-07-07

| Pregunta | Respuesta |
|---|---|
| **Qué cambia** | Toda respuesta de error pasa a tener la forma `{codigo, mensaje, detalles?, correlationId, timestamp}`. Reemplaza formas previas inconsistentes: `{error: "..."}` (farmacia-api en varios endpoints), `{aceptada:false, referencia:null, motivo:"..."}` en el 400 de validación de `POST /recepcionar-receta`, `{codigo, mensaje}` sin `correlationId`/`timestamp` (aseguradora-api) |
| **Por qué cambia** | Manejo de errores no unificado era un hallazgo de auditoría (punto D): imposibilita que un cliente trate los errores de forma consistente, y varios 400 no traían detalle por campo |
| **A quién afecta** | `medicitas-frontend` (todos los backends), `medicitas-backend` → `farmacia-api` (`FarmaciaAxiosAdapter.js`, que leía `response.data?.motivo` en el 400 de configuración) |
| **Es compatible** | Parcialmente — el **contrato de negocio exitoso** (`{aceptada, referencia, motivo}` en el 200 de `POST /recepcionar-receta`) se preservó intacto a propósito; solo cambió la forma de las respuestas de **error** (400/401/404/409/500) |
| **Requiere nueva versión** | Sí para la parte de error — coincide con "no debes cambiar los códigos de error sin revisar a los consumidores" |
| **Cómo se comunicó** | `FarmaciaAxiosAdapter.js` (el único consumidor interno afectado) se actualizó en el mismo commit para leer `.mensaje` con fallback a `.motivo` — compatible con ambas formas durante la transición |
| **Cómo se prueba** | Verificado en esta sesión en los 3 backends: JSON malformado → 400 con envelope completo; validación Zod fallida → 400 con `detalles` por campo; 404/409 vía `DomainError` → envelope completo; el 200 de negocio de farmacia-api quedó byte-a-byte igual que antes |

---

## 4. Cambios compatibles incluidos en v2 (no requieren nueva versión por sí solos)

Se listan por completitud — no son la causa del salto a v2, pero viajan en el mismo corte:

### 2026-07-03 (sesión de observabilidad)

| Repo | Cambio | Por qué es compatible |
|---|---|---|
| Los 4 | Tracing distribuido con OpenTelemetry + Jaeger | Infraestructura interna, invisible al contrato HTTP |
| Los 3 backends | Logging estructurado dual (stdout + Loki) | Interno, sin efecto en respuestas |
| medicitas-backend | Fix de reintento infinito en 4 consumers RabbitMQ (contador `x-retry-count`) | Corrección de bug interno; el contrato de los eventos no cambió |
| medicitas-backend | WhatsApp: apagado gracioso, limpieza de locks huérfanos, handlers globales de excepción | Interno a la infraestructura de notificaciones |
| medicitas-backend | Fix de seed data `series_comprobante` en `init.sql` | Corrección de datos, no de contrato |
| medicitas-frontend | Fix de `proxy_buffering` en nginx para SSE | Restaura comportamiento esperado (bug fix) |
| medicitas-frontend | Filtro `estado` opcional en listado de pacientes | Query param opcional — explícitamente permitido sin nueva versión |
| medicitas-frontend | Invalidación de queries React Query en eventos SSE | Interno al cliente |

### 2026-07-07 (auditoría de producción)

| Repo | Cambio | Por qué es compatible |
|---|---|---|
| medicitas-backend | Autorización a nivel de recurso (IDOR) en horarios/bloqueos/historia clínica | Restringe accesos que nunca debieron estar permitidos; ningún consumidor legítimo pierde acceso a sus propios recursos |
| Los 3 backends | PII enmascarada en logs | No toca ningún contrato HTTP |
| medicitas-backend | Compensaciones (reversar pago → cancela cita; cita expirada → libera slot Redis) | Efectos secundarios internos, no cambian la respuesta del endpoint que los origina |
| farmacia-api, aseguradora-api | Outbox local de webhooks salientes (durabilidad) | Mejora de entrega, mismo payload/contrato del webhook |
| medicitas-backend | Validación Zod en endpoints críticos | Rechaza inputs que ya eran inválidos según las reglas de negocio existentes; un consumidor que enviaba datos válidos no ve cambio |
| Los 3 backends | `correlationId` + `/metrics` (Prometheus) | Aditivo — nuevo endpoint/header, no reemplaza nada |
| medicitas-backend | Acoplar pago↔cita (`REQUERIR_PAGO_PARA_INGRESO`) | **Off por defecto** — cero efecto salvo que se active explícitamente |
| medicitas-backend | Dashboards Grafana + alertas nuevas | No es superficie de API |
| medicitas-backend | Estructura hexagonal unificada en `auth`/`medicos`/`pacientes` (`adapters/{in,out}`+`ports/`) | Reorganización interna de archivos — mismas rutas HTTP, mismo comportamiento, verificado end-to-end |
| medicitas-backend | Eliminación de `bullmq` sin uso, 2 scripts de debug con credenciales hardcodeadas, secreto de fallback hardcodeado en `facturacion/PacienteHttpAdapter.js` | Código muerto o nunca alcanzable en producción |
| aseguradora-prosalud-api | Fix de bug en `OutboxWorker` (mysql2 rechazaba `LIMIT` como placeholder) | Corrección de bug — restaura la publicación de eventos que nunca había funcionado; **nota**: al desplegar drenó un backlog acumulado de eventos hacia RabbitMQ de una sola vez, lo cual sí es observable por el consumer de auditoría (evento discreto, no rotura de contrato) |

---

## 5. Nota de gobierno — desviación consciente del proceso ideal

El framework exige, para todo breaking change: aviso previo, ventana de deprecación con fecha de retiro, y comunicación a los consumidores antes del cambio. **Eso no ocurrió en tiempo real** para los 3 breaking changes de §3 — se desarrollaron y desplegaron de forma coordinada dentro de la misma sesión de trabajo, actualizando simultáneamente todos los consumidores conocidos (los propios repos del ecosistema).

Esto fue viable sin proceso formal de deprecación porque se cumple la precondición que el propio framework exige antes de poder tocar un contrato: *"si no sabes quién consume tu API, no estás autorizado a cambiarla"* — en este caso **sí se sabe exactamente quién consume cada contrato** (los otros 3 repos del mismo ecosistema, bajo el mismo control), y los 4 se actualizaron a la vez. No hay terceros externos con acceso a estas APIs hoy.

Esta condición **puede dejar de cumplirse** el día que cualquiera de estos servicios tenga un consumidor externo real (otra clínica, un partner, una app de terceros). A partir de ese momento, cualquier breaking change nuevo debe seguir el proceso completo: anunciar qué/desde cuándo/hasta cuándo/alternativa/responsable, mantener v1 viva durante la ventana de gracia, y solo entonces retirarla. Este documento es también el punto de partida de esa disciplina hacia adelante — v2 es la primera versión formalmente registrada; la siguiente ruptura de contrato debe pasar por peer review y el checklist de gobierno completo **antes** de desplegarse, no como registro retroactivo.

---

## 6. Registro de versión

| Repo | Versión anterior | Versión v2 |
|---|---|---|
| `medicitas-backend` | 1.0.0 | **2.0.0** |
| `farmacia-api` | 1.0.0 | **2.0.0** |
| `aseguradora-prosalud-api` | 2.0.0 (ver nota) | **2.0.0** |
| `medicitas-frontend` | — (sin cambio de contrato de API propio; consume las APIs anteriores) | sin bump — no expone contrato |

Reflejado en `package.json` (`version`) y en el título/`info.version` de Swagger de cada backend.

> **Nota**: `aseguradora-prosalud-api/package.json` ya traía `"version": "2.0.0"` desde su **commit inicial** (`f199b86`) — un número arbitrario, no producto de un versionado real anterior. Coincide por casualidad con el número que le corresponde ahora bajo este framework; se deja igual, pero se deja constancia de que no hubo una v1.x real detrás de ese número previo.
