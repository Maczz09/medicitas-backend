# Auditoría de mejoras — MediCitas

Lista priorizada de mejoras detectadas durante el trabajo de carga/observabilidad.
Ordenadas por relación **impacto / esfuerzo**. No son bugs (el sistema funciona);
son oportunidades para robustez, rendimiento y mantenibilidad.

**Estado 2026-07-12: TODAS COMPLETADAS** (excepto la #10 en su variante avanzada,
ver nota). Se deja el documento como registro de qué se hizo y cómo.

## P1 — Alto impacto

### 1. Trazas end-to-end conectadas (propagación de `traceparent` por el outbox) ✅ HECHA
**Qué:** en Jaeger el flujo `cita → pago → seguro → factura → notificación`
aparecía como **trazas separadas** (una por request HTTP, otra por cada consumer),
porque el patrón outbox (tabla MySQL + worker aparte) rompe la propagación
automática del contexto de trace.
**Cómo se hizo (distinto a lo planeado, con el mismo resultado):** en vez de
migrar una columna `traceparent` a las 11 tablas outbox, se reutilizó el patrón
que el proyecto ya usaba para `_actor`/`_timestamp` — los metadatos viajan
DENTRO del payload JSON del evento:
- `src/shared/infrastructure/traceContext.js` (nuevo): `capturarTraceMeta()`
  captura el contexto OTel activo como `_traceparent`/`_tracestate`, y
  `ejecutarConContexto()` ejecuta un handler dentro del contexto extraído.
- Los 8 publishers de outbox + `shared/infrastructure/outbox.js` incrustan
  `capturarTraceMeta()` en el payload.
- `rabbitmq.publishEvent` (worker sin SDK de OTel) saca esos campos del payload
  y los pone LITERALES como headers AMQP estándar W3C.
- Los 4 consumers (facturación, auditoría, notificaciones, prescripciones)
  ejecutan su handler con `ejecutarConContexto(msg.properties.headers, ...)`.
**Verificado en vivo:** un `POST /auth/login` produce UNA traza en Jaeger que
contiene el request HTTP, el INSERT al outbox y el INSERT del consumer de
auditoría al otro lado de RabbitMQ. Nota: la instrumentación automática de
amqplib NO opera con amqplib v2, así que la propagación manual era necesaria.
Con `OTEL_SDK_DISABLED=true` (modo carga) todo degrada limpio (payload sin
`_traceparent`).

### 2. Limpieza de `medicitas_users.peticiones_idempotentes` ✅ HECHA
**Qué:** la tabla de idempotencia crecía sin límite (cada POST con
`Idempotency-Key` inserta una fila con el `response_body` completo).
**Cómo se hizo:** `workers/limpieza_idempotencia.cron.js` (nuevo, registrado en
`ecosystem.config.js` y en `workers/index.js` para dev) borra cada hora las
filas más viejas que `IDEMPOTENCIA_TTL_H` (default 24 h). Requirió rebuild de
la imagen `workers` (el ecosystem.config.js se copia en build).

### 3. Healthcheck profundo ✅ HECHA
**Qué:** `GET /health` solo devolvía `{status:'OK'}` sin verificar dependencias.
**Cómo se hizo:** `/health` queda como liveness liviano (a propósito: reiniciar
el backend no arregla un MySQL caído) y se agregó `GET /health/ready` que hace
`SELECT 1`, `redis.ping()` y verifica el canal de RabbitMQ, devolviendo 503 con
el detalle por dependencia si algo falla. Verificado en vivo: `READY` con
mysql/redis/rabbitmq `up`.

## P2 — Impacto medio

### 4. N+1 en el listado de encuentros clínicos ✅ HECHA
**Qué:** `EncuentroMySQLRepository.findPaginadoByExpediente` hacía una query de
prescripciones POR CADA encuentro del page.
**Cómo se hizo:** una sola query `WHERE id_encuentro IN (...)` y agrupación en
memoria — 1 round-trip en vez de N.

### 5. PDFs generados a disco (viola la regla "todo en memoria") ✅ HECHA
**Qué:** `PDFKitGenerator` (facturación) y `RecetaPDFGenerator` (prescripciones)
usaban `fs.createWriteStream` + volúmenes Docker.
**Cómo se hizo (ambos módulos):** los chunks de pdfkit se acumulan en memoria
(`generarBuffer()`), la emisión solo valida y guarda la `urlDescarga`
(`ruta_pdf` queda NULL, columna conservada por compatibilidad), y la ruta de
descarga REGENERA el PDF al vuelo desde la BD. Para que el documento no cambie
entre descargas, imprime la fecha de emisión persistida (`created_at`), no la
del día de la descarga. En prescripciones, `findParaPdf()` enriquece con
nombre de paciente/encuentro/referencia de farmacia vía JOIN (no se persisten
en `recetas_contingencia`). Se eliminaron los volúmenes `comprobantes_storage`
y `recetas_storage` del docker-compose. Verificado en vivo: ambas descargas
devuelven 200 `application/pdf` regenerado.

### 6. Código muerto: `src/modules/notificaciones/workers/notificaciones.consumer.js` ✅ HECHA
Borrado. El consumer real vive en `server.js` (`NotificacionesConsumer`).

### 7. Pool de conexiones vs. workers (documentar la regla) ✅ HECHA
Regla escrita en `src/config/database.js`: total de conexiones =
`WEB_CONCURRENCY × DB_POOL_SIZE`, debe rondar 3-4× los cores (con 10×20=200 el
throughput COLAPSABA; balance actual de carga: 6×8=48).

## P3 — Higiene / mantenibilidad

### 8. Sin suite de tests automatizados ✅ HECHA (base inicial)
**Cómo se hizo:** Jest (`npm test`), 10 suites / 68 tests en `tests/unit/` sobre
la lógica pura crítica: máquina de estados de `Cita` (incluida la expiración a
`No_Asistida`), `FechaHoraCita` (tolerancia 30 min y fechas locales),
`RangoHorario`, `SemanaISO` (normalización local al lunes — el bug UTC-5),
`Bloqueo` (solapamientos y bordes), `ResolverHorarioEfectivoUseCase` (la regla
"la semana específica manda, sin caer a plantilla por día"),
`ConsultarSlotsUseCase` (slots libre/bloqueado/ocupado), `Comprobante`
(transiciones), middleware de idempotencia (con BD mockeada) y `traceContext`.
Ampliar incrementalmente al agregar lógica nueva.

### 9. Dos convenciones de tabla `outbox` (A y B) ✅ HECHA
**Qué:** convivían `id/evento/publicado` (6 esquemas) y
`id_evento/tipo_evento/estado` (5 esquemas); el worker las auto-detectaba.
**Cómo se hizo:** unificado TODO hacia la convención B (más expresiva: `estado`
con FALLIDO, `publicado_en`, `error_msg`) con
`db/migrations/005_unificar_outbox_convencion.sql` — ya aplicada a la BD local.
El worker quedó sin auto-detección, los publishers y `db/init.sql` usan la
convención única, y se agregó el índice `idx_estado (estado, creado_en)` a las
11 tablas (el worker consulta eso cada 5 s y las tablas B no tenían índice).
El worker ahora también persiste `error_msg` al fallar una publicación.
**Bug encontrado de pasada:** `svc_hor` NO estaba en la lista `SCHEMAS` del
worker — los eventos del módulo horarios (`PlantillaHorarioActualizada`,
`HorarioSemanaDefinido`, `BloqueoRegistrado`) se escribían al outbox pero nadie
los publicaba jamás. Corregido; los 6 eventos atascados desde el 08-07 se
publicaron al reiniciar.

### 10. Rate limiting por IP (no por usuario) ✅ HECHA (variante por token)
**Cómo se hizo:** `claveRateLimit` en `src/app.js` — con `Authorization: Bearer`
se limita por `sub`/`idUsuario` del JWT (sin verificar firma, solo para keying;
auth valida aparte); sin token cae a la IP normalizada. Pendiente opcional:
límites diferenciados por ruta sensible (login más estricto, etc.).

## Bugs encontrados y corregidos en las pruebas de carga total (2026-07-13)

Al construir la prueba de cobertura total (`loadtest/carga-full.js`, toca los 12
módulos) bajo carga real, aparecieron 4 fallos que en las pruebas parciales no se
veían — todos corregidos:

### A. Colisión de ID de cobertura bajo concurrencia ✅
`Cobertura.crear()` usaba `id = COB-${Date.now()}`. Con varias validaciones en el
mismo milisegundo → `Duplicate entry` en la PK → 500 intermitente en
`/coberturas/validar` (y rompía la cascada de pago). Fix: sufijo aleatorio
(`COB-<ts>-<rand>`), mismo patrón anti-colisión que `Cita`.

### B. `GET /notificaciones/sms/paciente/:id` → 500 ✅
`MensajesSMSMySQLRepository.findByIdPaciente` usaba `LIMIT ? OFFSET ?` con
`execute()` (prepared statements) → `ER_WRONG_ARGUMENTS` de mysql2 (bug conocido
del protocolo binario). Fix: validar enteros e interpolar `LIMIT ${n}` directo
(mismo patrón que el `GET /` del mismo módulo). Además ahora loguea el error real
antes de envolverlo.

### C. Métricas fragmentadas en modo cluster ✅ (observabilidad)
Con `CLUSTER_MODE=true` cada worker tenía su propio registro prom-client y
Prometheus scrapeaba `backend:3000` → un worker al azar → los contadores salían
en 0 o subcontados bajo carga. Fix: `src/config/metricsServer.js` — el proceso
primary expone un endpoint AGREGADO en `:9091` que combina (vía IPC,
`AggregatorRegistry` con `setRegistries` apuntando al registro custom) las
métricas de los N workers. `monitoring/prometheus.yml` ahora scrapea `:9091`.

### D. Contadores de negocio nunca se incrementaban ✅ (observabilidad)
`citasCreadasCounter`, `pagosCompletadosCounter`, `comprobantesEmitidosCounter`,
`smsEnviadosCounter`, `segurosValidadosCounter`, `encuentrosHclCounter` vivían en
los use cases VIEJOS (`*.usecases.js`, código muerto no cableado). Los use cases
hexagonales ACTIVOS (`ReservarCitaUseCase`, `ConfirmarPagoUseCase`,
`GenerarComprobanteUseCase`, `NotificarPacienteUseCase`, `ValidarCoberturaUseCase`,
`RegistrarConsultaUseCase`) no los tocaban → dashboards de negocio en 0. Fix:
`.inc()` movido a cada use case activo tras el commit. Verificado end-to-end: 1
cascada = +1 cita, +1 pago, +1 comprobante, +1 SMS (números consistentes).

> Resultado tras los fixes: `carga-full.js` con 40k requests, 15-20 VUs, 70%
> escrituras → **0% errores 5xx**, cascadas completas, y los 12 servicios con
> trazas (Jaeger), métricas (Grafana) y logs (Loki). Ver `loadtest/COMANDOS.md`.

## Bugs encontrados al construir el flujo clínico E2E (2026-07-13, noche)

### E. Dos fuentes de verdad de disponibilidad — "fase 4" del módulo horarios ✅
`MedicoDisponibilidadDBAdapter` (el que valida las RESERVAS de citas) leía
`svc_med.horarios_base` (tabla del módulo viejo) con su propia lógica: ignoraba
los horarios de SEMANA específica y los bloqueos de `svc_hor`. GET /slots
mostraba un slot libre y la reserva lo rechazaba con COLISION_HORARIO (o al
revés: aceptaba horas recién bloqueadas). Fix: el adaptador ahora delega en
`ResolverHorarioEfectivoUseCase` + `bloqueos_agenda` — la MISMA fuente única
que /slots (completa la "fase 4" que el comentario de ese use case anunciaba).

### F. La caché de disponibilidad no se invalidaba al cambiar la agenda ✅
Definir un horario (plantilla o semana) o un bloqueo dejaba
`cache:disponibilidad:<medico>:<fecha>` (TTL 300 s) obsoleta: hasta 5 minutos
de reservas validadas contra la agenda VIEJA. Fix:
`src/modules/horarios/infrastructure/invalidarCacheDisponibilidad.js`, llamado
tras el commit en DefinirHorarioSemana/DefinirPlantilla/RegistrarBloqueo.

### G. Observabilidad por defecto en TODAS las máquinas ✅
`OTEL_SDK_DISABLED` tenía default `true` en modo carga → en cualquier clon
nuevo (la laptop) las pruebas corrían SIN trazas y `medicitas-backend` ni
aparecía en Jaeger. Ahora el default del repo es **false con muestreo al 10%**
(`parentbased_traceidratio`) — seguro para WSL2 (el colapso histórico era al
100%) y las trazas se ven siempre, en cualquier máquina, sin variables de
sesión. `lean` ya no para Jaeger. Diagnóstico en 1 comando:
`loadtest/verificar-observabilidad.ps1|.sh`.

## Hallazgos del experimento Chaos Monkey (2026-07-13)

Ver `docs/CHAOS-MONKEY.md §7` para el detalle. El experimento (bajar servicios
al azar bajo carga) cumplió aislamiento, recuperación automática, sin pérdida
de eventos y trazabilidad. Expuso además:

### H. Acoplamiento seguros→pacientes sin degradación grácil ✅ CORREGIDO
Con `pacientes` de baja, `POST /coberturas/validar` lanzaba **500** (llamaba
internamente a la API de Pacientes vía `existePaciente` sin manejo de fallo). Un
500 parece crash. Fix en `ValidarCoberturaUseCase`: distinguir 404 (no existe)
de servicio caído → **503 DEPENDENCIA_NO_DISPONIBLE** reintentable. Verificado.

### I. (PENDIENTE) Backlog del outbox bajo escritura pesada
El worker drena `LIMIT 50` por ciclo de 5 s (~600 ev/min por esquema). Bajo
carga sostenida muy alta el backlog crece (drena al bajar la carga). Si la carga
real se acerca al techo: subir el batch o reducir el intervalo (con cuidado del
tiempo de lock). No crítico para uso normal.

### J. (PENDIENTE) `POST /pacientes` sin telefono → 500 en vez de 400
El schema Zod marca `telefono` opcional pero la columna `svc_pac.pacientes.
telefono` es NOT NULL → 500 (`Column 'telefono' cannot be null`). Alinear:
hacer la columna nullable, o el schema obligatorio, o default '' en el repo.

## Ya hecho en sesiones anteriores (no repetir)
- Right-size del pool + índice `(activo, created_at)` + query de pacientes sin
  `SQL_CALC_FOUND_ROWS` → el 1M pasa al 100%.
- OTel apagado/muestreado en carga → estabilidad de WSL2.
- Log de acceso por request → todas las peticiones en Loki.
- Catch-all 404 + `docs/MANEJO-ERRORES.md`.
- Kill-switch en Redis para resiliencia por servicio.
