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

**Versión en la URL** (`/api/v1/...` → `/api/v2/...`), por ser la estrategia ya establecida de facto en los 3 backends (todos los endpoints ya vivían bajo `/api/v1/`) y la más simple/visible de las tres opciones aceptadas.

**Estado de implementación**: implementada en su totalidad. Los 3 backends renombraron **todas** sus rutas de `/api/v1/*` a `/api/v2/*` (mounts en `app.js`, adaptadores S2S internos, URLs embebidas en respuestas, Swagger, webhooks salientes/entrantes) — sin mantener un alias en `/api/v1/` (una petición a esa ruta hoy devuelve 404). No se optó por exponer ambas versiones en paralelo porque el comportamiento que servía `/api/v1/` ya no existe en el código: los 3 breaking changes de la tabla anterior reemplazaron ese comportamiento por completo, así que un alias en `/api/v1/` habría ejecutado exactamente el mismo código que `/api/v2/` bajo un nombre engañoso, sin restaurar nada del contrato viejo. Los 4 consumidores del ecosistema (los propios repos, todos bajo control directo) se actualizaron en el mismo movimiento — no existe hoy un consumidor externo desconocido corriendo contra la forma vieja del contrato.

Verificado end-to-end tras el despliegue: `/api/v2/*` responde correctamente en los 3 backends (login, médicos, pacientes, validar cobertura, health), `/api/v1/*` devuelve 404 limpio, el bundle del frontend desplegado no contiene ninguna referencia a `/api/v1` y sí a `/api/v2`, y el stream SSE (`/api/v2/realtime/stream`, sensible a la configuración de `nginx.conf`) conecta y entrega eventos reales sin cortes.

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

## 6. Registro de versión (v2.0.0)

| Repo | Versión anterior | Versión v2 |
|---|---|---|
| `medicitas-backend` | 1.0.0 | **2.0.0** |
| `farmacia-api` | 1.0.0 | **2.0.0** |
| `aseguradora-prosalud-api` | 2.0.0 (ver nota) | **2.0.0** |
| `medicitas-frontend` | — (sin cambio de contrato de API propio; consume las APIs anteriores) | sin bump — no expone contrato |

Reflejado en `package.json` (`version`) y en el título/`info.version` de Swagger de cada backend.

> **Nota**: `aseguradora-prosalud-api/package.json` ya traía `"version": "2.0.0"` desde su **commit inicial** (`f199b86`) — un número arbitrario, no producto de un versionado real anterior. Coincide por casualidad con el número que le corresponde ahora bajo este framework; se deja igual, pero se deja constancia de que no hubo una v1.x real detrás de ese número previo.

---

## 7. v2.1.0 — Contingencias, fallback de cobertura y auth de servicio (2026-07-07)

### 7.1 Por qué v2.1.0 y no v3 ni v2.1.1

Semver es `MAYOR.MENOR.PARCHE`. Los tres pedidos de esta ventana (fallback de aseguradora, contingencia de farmacia, auth de servicio) son **funcionalidad nueva**, no correcciones de bugs — por eso el dígito que sube es el del medio (`MENOR`), no el último (`PARCHE`, que habría sido incorrecto: v2.1.1 habría dado a entender que solo se corrigieron defectos).

No es **v3** porque, aplicando la misma regla de compatibilidad hacia atrás del §1: todo lo nuevo es **aditivo** (nuevo servicio, nuevos endpoints, nuevas columnas) y el único cambio con forma de "breaking" — el mecanismo de autenticación de servicio — se implementó deliberadamente compatible: el método viejo (`X-Webhook-Api-Key`) sigue funcionando exactamente igual que antes, en paralelo con el nuevo (`Authorization: Bearer <JWT tipo:SERVICE>`), durante una ventana de deprecación explícita (ver §7.4). Ningún consumidor existente (`farmacia-api`, `aseguradora-prosalud-api`, ambos aún sin migrar a la fecha de este registro) deja de funcionar con este release.

### 7.2 Inventario de cambios (todos aditivos/compatibles)

| Repo | Cambio | Por qué es compatible |
|---|---|---|
| `seguros-fallback-service` (**nuevo repo**, v1.0.0) | Cache persistente de pólizas + worker de reconciliación en background + balanceador nginx (2 réplicas) | Servicio nuevo, aislado en su propio proceso/red/BD — no toca ningún contrato existente |
| `medicitas-backend` | `AseguradoraAxiosAdapter`: cuando el circuit breaker está abierto, consulta el cache de `seguros-fallback-service` antes de devolver `PENDIENTE` genérico | El `esFallback:true/PENDIENTE` de siempre sigue siendo la red de seguridad final si el cache tampoco responde o no tiene el dato — ningún consumidor ve una forma de respuesta nueva, solo mejores datos en el mismo shape (`estadoCobertura`, `esFallback`, ahora con `origenFallback` opcional) |
| `medicitas-backend` | Nuevo endpoint interno `POST /api/v2/coberturas/interno/eventos-fallback` (relé de auditoría desde `seguros-fallback-service`) | Endpoint nuevo, aditivo, protegido por `INTERNAL_SERVICE_TOKEN` |
| `medicitas-backend` | Contingencia de farmacia: `GenerarRecetaContingenciaUseCase` genera un PDF de receta y dispara un WhatsApp con el link de descarga cuando el circuit breaker hacia farmacia-api está **abierto** (no en cada blip transitorio) | Rama de código nueva, solo se ejecuta en el escenario de caída sostenida; el flujo normal de despacho (cola → reintento → DLQ) no cambia |
| `medicitas-backend` | Nuevos endpoints `GET /api/v2/prescripciones/contingencia` (listado, autenticado) y `GET /api/v2/prescripciones/contingencia/:id/pdf` (descarga pública, mismo patrón que `/facturacion/comprobantes/:id/pdf`) | Aditivos |
| `medicitas-backend` | `GET /api/v2/prescripciones` (listado existente) ahora incluye `contingencia_url_descarga`; nuevo query param opcional `?contingencia=true` | Campo/parámetro nuevo y opcional — un consumidor que no lo envía/lee no ve cambio |
| `medicitas-backend` | Auth de servicio: nuevo endpoint `POST /api/v2/auth/service-token` (client-credentials), tabla `service_clients` | Endpoint nuevo, aditivo |
| `medicitas-backend` | `verifyWebhookApiKey.middleware.js` acepta `Authorization: Bearer <JWT tipo:SERVICE>` además de `X-Webhook-Api-Key` | Ambos métodos coexisten — ver §7.4 para la fecha de retiro del método viejo |
| `medicitas-frontend` | `RecetasPage`/`AdminPrescripcionesPage`: badge y filtro "Contingencia" | Aditivo — usa el campo nuevo y opcional de arriba |
| `medicitas-frontend` | Cierre de sesión ~5s después de cerrar la ventana/pestaña | Ver §7.5 para la limitación técnica y la interpretación implementada |

### 7.3 Hallazgos de esquema corregidos de paso (drift, no relacionados con lo nuevo)

Durante la implementación se encontraron y corrigieron 3 desincronizaciones entre `db/init.sql` y el esquema realmente vivo en producción (mismo patrón de bug ya corregido para `svc_seg.validaciones_cobertura` en la sesión anterior — `init.sql` no se había mantenido al día con `ALTER TABLE`s aplicados directamente):

- `svc_pre.despachos_receta` (nombre y columnas de `init.sql`) → la tabla viva se llama `despachos` y tiene columnas distintas (`id_evento_origen`, `contenido`, `fecha_despacho`, etc., ausentes de la definición vieja). Un despliegue nuevo desde `init.sql` habría roto el módulo de prescripciones por completo.
- `svc_pre.outbox` en `init.sql` usaba la convención de columnas B (`id_evento`/`tipo_evento`/`estado`); la tabla viva usa la convención A (`id`/`evento`/`publicado`), la misma que `OutboxEventPublisher.js` de prescripciones siempre escribió.
- `svc_not.mensajes_sms.estado` — el ENUM vivo no incluía `PENDIENTE_VINCULACION` (usado por `MensajeSMS.crearPendienteVinculacion()` cada vez que WhatsApp está desvinculado). Esto significaba que **toda notificación intentada mientras WhatsApp estaba desvinculado fallaba silenciosamente y terminaba en la DLQ tras 3 reintentos**, sin quedar registrada para reenvío posterior — un bug de producción real, descubierto al probar la contingencia de farmacia con la sesión de WhatsApp desvinculada. Corregido en vivo y en `init.sql`.

### 7.4 Ventana de deprecación — `X-Webhook-Api-Key`

Siguiendo la disciplina que el propio §5 dejó pendiente para la próxima ruptura de contrato:

| Campo | Valor |
|---|---|
| **Qué se deprecia** | Autenticación de webhooks/S2S vía header estático `X-Webhook-Api-Key` |
| **Alternativa** | `Authorization: Bearer <token>` emitido por `POST /api/v2/auth/service-token` (client-credentials, vida de 1h, renovable) |
| **Desde cuándo** | 2026-07-07 (este release) — ambos métodos activos en paralelo desde hoy |
| **Hasta cuándo** | 2026-09-05 (60 días) — fecha objetivo para retirar `X-Webhook-Api-Key`; requiere que `farmacia-api` y `aseguradora-prosalud-api` migren a pedir y usar el token de servicio antes de esa fecha |
| **Responsable** | Equipo de plataforma (`medicitas-backend`) coordina el retiro; los propios repos de farmacia/aseguradora son quienes deben migrar su llamada saliente |
| **Estado a la fecha de este registro** | `farmacia-api` y `aseguradora-prosalud-api` **aún no migrados** — siguen usando `X-Webhook-Api-Key`. Se generaron credenciales de servicio (`svc-farmacia-api`, `svc-aseguradora-api`) en `medicitas_users.service_clients`, listas para cuando se actualice el código de esos dos repos |

### 7.5 Cierre de sesión tras cerrar ventana — interpretación implementada

Un navegador no permite ejecutar un timer *después* de que la pestaña ya se cerró, así que "cerrar sesión 5 segundos después de cerrar la ventana" no es literalmente implementable tal cual. La interpretación usada (`useCloseWindowLogout.ts`): al detectar `pagehide` (cierre de pestaña, recarga completa o navegación fuera de la SPA) se guarda el instante en `localStorage`; la próxima vez que la app carga o recupera el foco, si pasaron más de 5 segundos desde ese instante, se cierra la sesión automáticamente. Una recarga (F5) o una navegación interna de la SPA no activan el cierre — solo un cierre real seguido de una ausencia de más de 5s.

---

## 8. Registro de versión (v2.1.0)

| Repo | Versión anterior | Versión v2.1.0 |
|---|---|---|
| `medicitas-backend` | 2.0.0 | **2.1.0** |
| `seguros-fallback-service` | — (repo nuevo) | **1.0.0** |
| `farmacia-api` | 2.0.0 | sin bump — sin cambios de código en esta ventana |
| `aseguradora-prosalud-api` | 2.0.0 | sin bump — sin cambios de código en esta ventana |
| `medicitas-frontend` | — (sin contrato de API propio) | sin bump — no expone contrato |
