# MediCitas Backend 🏥

Backend de **MediCitas**, un sistema de gestión clínica (citas, pacientes, historia clínica, seguros, pagos, prescripciones, facturación y notificaciones) construido como **monolito modular** con **arquitectura hexagonal** por módulo y **arquitectura orientada a eventos (EDA)** vía RabbitMQ + patrón Outbox.

El ecosistema completo incluye dos APIs externas independientes (`farmacia-api` y `aseguradora-prosalud-api`, cada una en su propio repositorio/stack Docker) con las que MediCitas se integra por HTTP síncrono, webhooks asíncronos y tracing distribuido compartido.

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Módulos y endpoints](#módulos-y-endpoints)
3. [Comunicación entre servicios](#comunicación-entre-servicios)
4. [Patrón Outbox](#patrón-outbox)
5. [Workers](#workers)
6. [Resiliencia](#resiliencia)
7. [Seguridad](#seguridad)
8. [Tiempo real (SSE)](#tiempo-real-sse)
9. [Observabilidad](#observabilidad)
10. [Seguridad ofensiva — OWASP ZAP](#seguridad-ofensiva--owasp-zap)
11. [Infraestructura Docker](#infraestructura-docker)
12. [Variables de entorno](#variables-de-entorno)
13. [Instalación y ejecución](#instalación-y-ejecución)
14. [Comandos](#comandos)

---

## Arquitectura

**Monolito modular**: todo el código corre en un solo proceso Node.js (`src/server.js`), pero está dividido estrictamente en `src/modules/<dominio>/`, cada uno con su propia base de datos lógica (schema MySQL independiente) y, en la mayoría de los casos, su propia estructura hexagonal interna:

```
src/modules/<dominio>/
├── domain/            # Entidades, value objects, errores de dominio — sin dependencias externas
├── application/        # Casos de uso (use cases) — orquestan domain + ports
├── ports/out/           # Interfaces (contratos) que desacoplan aplicación de infraestructura
├── adapters/
│   ├── in/              # Controladores HTTP (puerto primario)
│   └── out/
│       ├── repositories/   # Implementación MySQL de los ports
│       ├── events/          # Publisher del outbox (OutboxMySQLPublisher / OutboxEventPublisher)
│       ├── gateway/          # Clientes HTTP hacia APIs externas (Axios + Circuit Breaker)
│       ├── http/               # Clientes HTTP internos (S2S) hacia otros módulos
│       └── cache/               # Adaptadores de Redis
├── routes/             # Definición de rutas Express + Swagger JSDoc
└── consumer/            # Consumer de RabbitMQ (si el módulo reacciona a eventos)
```

Los módulos: `auth`, `pacientes`, `medicos`, `citas`, `seguros`, `pagos`, `historiaclinica`, `prescripciones`, `facturacion`, `notificaciones`, `auditoria`.

**Por qué "S2S por HTTP" en vez de llamadas de función directas:** varios módulos se validan entre sí (p. ej. Pagos verifica el estado de una Cita) haciendo una petición HTTP a `localhost:3000/api/v1/...` con un token interno (`INTERNAL_SERVICE_TOKEN`), en vez de importar el código del otro módulo directamente. Esto es deliberado: mantiene los módulos desacoplados como si ya fueran microservicios, así que extraer cualquiera de ellos a un servicio separado en el futuro no requiere reescribir la lógica de negocio, solo cambiar la URL base del cliente HTTP.

**Múltiples schemas MySQL** en el mismo servidor (no una sola base de datos compartida): `medicitas_users`, `svc_pac`, `svc_med`, `svc_cit`, `svc_seg`, `svc_pag`, `svc_hcl`, `svc_pre`, `svc_fac`, `svc_not`, `svc_aud`. Cada módulo solo tiene permisos/lee-escribe su propio schema — evita el acoplamiento de tablas típico de un monolito "de verdad".

---

## Módulos y endpoints

Todos los endpoints cuelgan de `/api/v1/` detrás del gateway Nginx (puerto `80`) o directo contra el backend (puerto interno `3000`, no publicado al host). Documentación interactiva completa en Swagger: **http://localhost/api-docs/**

| Módulo | Base | Resumen |
|---|---|---|
| Auth | `/auth` | login, refresh, forgot/reset-password (OTP por correo), registro y gestión de usuarios internos, asignación de rol |
| Pacientes | `/pacientes` | CRUD + búsqueda paginada + filtro por `estado` (activo/inactivo/todos) + soft-delete (`PATCH /:id/estado`) |
| Médicos | `/medicos` | CRUD, disponibilidad de agenda (cacheada en Redis), horarios base, bloqueos |
| Citas | `/citas` | reservar, cancelar, reprogramar, registrar ingreso, completar (llamado interno desde Historia Clínica) |
| Coberturas (Seguros) | `/coberturas` | validar cobertura contra `aseguradora-api` (Circuit Breaker + Retry), recovery replay de pendientes |
| Pagos | `/pagos` | confirmar pago físico, reversar, consulta por cita |
| Historia Clínica | `/historias-clinicas` | crear/consultar expediente, registrar encuentro clínico + prescripciones |
| Prescripciones | `/prescripciones` | listado paginado (filtro por `estado`), consulta por ID, reintentar envío rechazado, marcar retirada |
| Facturación | `/facturacion` | consulta de comprobantes (generados automáticamente al consumir `PagoAprobado`), descarga PDF |
| Notificaciones | `/notificaciones` | historial de SMS/WhatsApp enviados |
| Auditoría | `/auditoria` | trazas por servicio/tipo de evento, reconstrucción de flujo completo por `correlationId`, healthcheck de dependencias externas |
| Webhooks entrantes | `/webhooks/farmacia`, `/webhooks/seguros` | notificaciones asíncronas desde farmacia-api y aseguradora-api (ver [Comunicación entre servicios](#comunicación-entre-servicios)) |
| Tiempo real | `/realtime/stream` | Server-Sent Events — ver [sección dedicada](#tiempo-real-sse) |

---

## Comunicación entre servicios

### RabbitMQ

- **Exchange:** `medicitas.events` (`topic`, durable, vhost `medicitas`)
- **UI de administración:** http://localhost:15672 (usuario/clave en `.env`: `RABBITMQ_USER` / `RABBITMQ_PASSWORD`)

| Cola | Routing keys | Consumer | DLQ |
|---|---|---|---|
| `q.facturacion` | `event.PagoAprobado` | Facturación (genera comprobante + PDF) | ✔️ |
| `q.notificaciones` | `CitaCreada`, `CitaCancelada`, `CitaReprogramada`, `PagoAprobado`, `ComprobanteEmitido` | Notificaciones (SMS/WhatsApp) | ✔️ |
| `q.prescripciones` | `event.PrescripcionEmitida` | Prescripciones (envía la receta a farmacia-api) | ✔️ |
| `q.auditoria` | `#` (todos los eventos) | Auditoría (log inmutable de todo lo que pasa en el sistema) | ✔️ |
| `q.realtime.<uuid>` | `#` | Efímera, una por cada conexión de backend activa — alimenta el stream SSE | — |

**Reintentos con tope real:** las colas clásicas de RabbitMQ no pueblan `x-delivery-count` de forma nativa (eso solo existe en quorum queues), así que un `nack(requeue=true)` sin más reencola el mensaje **indefinidamente** sin ningún contador visible. Los 4 consumers (`facturacion`, `notificaciones`, `prescripciones`, `auditoria`) implementan su propio contador vía un header `x-retry-count`: al fallar, hacen `ack` del mensaje original y **republican** una copia con el contador incrementado; al llegar a `*_MAX_REINTENTOS` (env var por módulo, default `3`), se envía a la DLQ correspondiente con `nack(requeue=false)`.

### APIs externas (farmacia-api, aseguradora-prosalud-api)

| Dirección | Origen → Destino | Mecanismo |
|---|---|---|
| Saliente | SVC-SEG → `aseguradora-api` `GET /asegurados/validar` | Axios + Circuit Breaker (`opossum`) + Retry Full Jitter |
| Saliente | SVC-PRE → `farmacia-api` `POST /recepcionar-receta` | Axios + Circuit Breaker + Retry Full Jitter |
| Entrante | `farmacia-api` → `POST /api/v1/webhooks/farmacia` | Notifica cambio de estado de una receta (retirada/rechazada) |
| Entrante | `aseguradora-api` → `POST /api/v1/webhooks/seguros` | Notifica cambio de estado de una póliza |

Los webhooks entrantes se autentican con un **secreto compartido bidireccional**: la misma `FARMACIA_API_KEY` / `ASEGURADORA_API_KEY` que MediCitas usa para llamar a esas APIs, autentica también las llamadas en sentido inverso (header `X-Webhook-Api-Key`, comparación constant-time vía `crypto.timingSafeEqual`, fail-closed si la env var no está configurada). Ver `src/shared/infrastructure/webhooks/verifyWebhookApiKey.middleware.js`.

**Toggle mock/real** (no tocar en producción sin confirmar con el equipo):
```
USE_MOCK_SEGURO=false     # false → llama a aseguradora-prosalud-api real
USE_MOCK_FARMACIA=false   # false → llama a farmacia-api real
USE_MOCK_SMS=<sin setear> # sin definir → usa WhatsApp Web real (Puppeteer); 'true' → mock
```

### Idempotencia

Header `Idempotency-Key` (UUID) soportado en operaciones críticas (reserva de citas, validar cobertura, reintentar receta, marcar retirada). Se registra en `medicitas_users.peticiones_idempotentes`; una segunda petición con la misma clave devuelve la respuesta cacheada sin reprocesar. Middleware: `src/shared/infrastructure/api_idempotency.middleware.js`.

### Correlation ID

Cada request HTTP genera (o hereda de `X-Correlation-Id`) un `correlationId` que se propaga por: headers HTTP salientes, el sobre de cada evento RabbitMQ, los logs estructurados (Pino) y las trazas de OpenTelemetry (como atributo de span) — permite reconstruir un flujo de negocio completo cruzando logs (Loki), trazas (Jaeger) y auditoría (`GET /auditoria/correlacion/:id`).

---

## Patrón Outbox

Ningún módulo publica a RabbitMQ directamente desde el request HTTP. En su lugar:

1. Dentro de la misma transacción MySQL que el cambio de negocio, se inserta una fila en la tabla `outbox` del schema del módulo.
2. `workers/outbox.worker.js` (cron cada 5s, corre en el contenedor `workers`) escanea la tabla `outbox` de **los 11 schemas**, publica cada evento pendiente a RabbitMQ y lo marca como publicado.
3. Si RabbitMQ está caído, el evento simplemente espera en la tabla — no se pierde ni bloquea la respuesta HTTP.

Conviven dos convenciones de columnas heredadas (el worker detecta cuál usa cada schema vía `INFORMATION_SCHEMA`):
- **Convención A** (`svc_cit`, `svc_pre`, `svc_hcl`): `id`, `evento`, `payload`, `publicado` (0/1)
- **Convención B** (resto): `id_evento`, `tipo_evento`, `payload`, `estado` (`PENDIENTE`/`PUBLICADO`)

---

## Workers

Contenedor separado (`Dockerfile.workers`), administrado por **PM2** (`ecosystem.config.js`), 3 procesos:

| Proceso | Frecuencia | Función |
|---|---|---|
| `worker-outbox` | cada 5s | Publica eventos pendientes de los 11 schemas a RabbitMQ (ver arriba) |
| `worker-alertas-llegada` | cada 1 min | Recordatorio 30 min antes de la cita + alertas de tolerancia de llegada (0/5/10/15 min) por SMS/WhatsApp; marca `No_Asistida` tras 15 min |
| `worker-tolerancia` | — | Stub vacío, lógica migrada a `worker-alertas-llegada`; se mantiene para no romper la config de PM2 |

Además, dentro del **propio proceso del backend** (no en `workers`) corren:
- Los 4 **consumers de RabbitMQ** (Facturación, Notificaciones, Prescripciones, Auditoría) — comparten el canal AMQP del proceso principal.
- El broadcaster de **Server-Sent Events** (consume `#` de `medicitas.events` en una cola efímera propia).
- **Recovery Replay de Farmacia**: dos disparadores — (a) al cerrar el Circuit Breaker de farmacia-api (evento `close` de `opossum`), y (b) un sondeo cada 60s (`REPLAY_FARMACIA_INTERVAL_MS`) — necesario porque un breaker en half-open solo cierra si alguien lo dispara, y sin recetas nuevas nadie lo haría. Reenvía despachos en estado `CREADA` (nunca llegaron a intentarse) y `RECHAZADA_POR_VALIDACION` (fallo de transporte, no de negocio).
- **Recovery Replay de Seguros**: `POST /coberturas/reintentar-pendientes` reevalúa coberturas en estado `PENDIENTE` cuando el Circuit Breaker de aseguradora-api cierra.

---

## Resiliencia

| Patrón | Dónde | Detalle |
|---|---|---|
| Circuit Breaker | Gateways a farmacia-api y aseguradora-api | `opossum`, `errorFilter` excluye 4xx (errores de configuración) del conteo de fallas — solo timeouts/5xx abren el circuito |
| Retry + Full Jitter | Gateways externos + 8 adaptadores S2S internos | `src/shared/resilience/retryConBackoffJitter.js` — `conRetryYFallback` (con fallback final) para gateways externos, `conReintentos` (relanza el error) para S2S internos. Nunca reintenta 4xx |
| Recovery Replay | Farmacia y Seguros | Ver [Workers](#workers) |
| Rate limiting con excepción S2S | `src/app.js` | 200 req/15min por defecto (`RATE_LIMIT_MAX`); las llamadas internas con `INTERNAL_SERVICE_TOKEN` válido quedan **exentas** — evita que un pico de eventos en cola devuelva 429 a operaciones internas legítimas |
| Rate limiting en APIs externas | farmacia-api, aseguradora-api | Backpressure middleware propio: rechaza con 503 si supera `MAX_SOLICITUDES_CONCURRENTES` |
| Auto-reconexión | RabbitMQ (`src/config/rabbitmq.js`) | Backoff exponencial 3s→30s, `registrarOnReconnect()` re-suscribe consumers tras reconectar |
| DLQ + retry acotado | Los 4 consumers RabbitMQ | Ver [Comunicación entre servicios](#comunicación-entre-servicios) |
| Bulkhead | Gateways HTTP externos | `http.Agent`/`https.Agent` propio con `maxSockets: 20` — aísla el pool de sockets del resto de llamadas salientes del proceso |
| nginx resiliente a reinicios | `nginx/nginx.conf` | `resolver 127.0.0.11 valid=10s` + variable en `proxy_pass` — sin esto, nginx resuelve el hostname del backend una sola vez al arrancar y queda con una IP muerta (502) tras cualquier reinicio del backend |

---

## Seguridad

- **JWT** (HS256, `JWT_SECRET`) con access token (`JWT_EXPIRES_IN`, default 8h) + refresh token opaco rotado en cada uso.
- **OTP** por correo (Nodemailer) para reseteo de contraseña.
- **RBAC**: roles `Recepcionista`, `Médico`, `Auditor`, `INTERNAL` (bypasea cualquier restricción de rol — reservado para tráfico S2S con `INTERNAL_SERVICE_TOKEN`).
- **Idempotency-Key** — ver arriba.
- **Webhooks entrantes** autenticados con secreto compartido — ver arriba.
- **Helmet** + CSP headers vía nginx (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Permissions-Policy`).
- **CORS** habilitado a nivel de Express.
- **Bloqueo de cuenta**: 3 intentos fallidos → lockout 15 minutos.

---

## Tiempo real (SSE)

En vez de WebSockets, el frontend recibe actualizaciones en vivo vía **Server-Sent Events** — server→client es lo único que se necesita (dashboards que se refrescan solos), y `EventSource` trae reconexión automática nativa del navegador sin código adicional.

```
Backend: cola RabbitMQ efímera (bind '#' a medicitas.events)
   → broadcastEvent() → todas las conexiones SSE activas
Frontend: EventSource('/api/v1/realtime/stream')
   → onmessage → queryClient.invalidateQueries() (React Query refresca todo)
```

Implementación: `src/shared/infrastructure/realtime.routes.js` (backend), `useRealtimeSync()` (frontend, montado una vez en la raíz de la app).

⚠️ Si el gateway nginx que sirve el frontend está delante de este endpoint, la location de `/api/v1/realtime/` necesita `proxy_buffering off` y un `proxy_read_timeout` largo — con buffering encendido (el default de nginx) los eventos quedan atrapados y nunca llegan en tiempo real; con el timeout corto por defecto la conexión persistente se corta cada ~30s.

---

## Observabilidad

| Herramienta | URL | Para qué |
|---|---|---|
| **Swagger UI** | http://localhost/api-docs/ | Documentación y prueba interactiva de todos los endpoints |
| **Grafana** | http://localhost:3001 (`GRAFANA_USER`/`GRAFANA_PASSWORD`) | Panel unificado — datasources Prometheus, Loki y Jaeger ya provisionados |
| **Prometheus** | http://localhost:9090 | Métricas (`/metrics` del backend, scrape cada 10s). Ejemplo de query: `up{job="medicitas-backend"}` |
| **AlertManager** | http://localhost:9093 | Reglas de alerta (`monitoring/alert.rules.yml`) |
| **Loki** | http://localhost:3100 (sin UI propia — usar Grafana Explore) | Logs estructurados centralizados |
| **Jaeger** | http://localhost:16686 | Tracing distribuido |
| **RabbitMQ Management** | http://localhost:15672 | Colas, tasas de mensajes, consumers activos |

### Logs estructurados (Pino → Loki)

`src/shared/logger/logger.js` usa Pino con **doble destino en paralelo** (`pino.transport({ targets: [...] })`): stdout (pino-pretty, lo que ves en `docker logs`) **y** Loki al mismo tiempo, de forma independiente. Esto es deliberado — con un solo destino a Loki, un corte momentáneo del contenedor de Loki hacía que esas líneas **desaparecieran para siempre**, ni en Grafana ni en `docker logs`. Con doble destino, `docker logs` sigue siendo confiable pase lo que pase con Loki.

Se activa con la env var `LOKI_HOST` (independiente de `NODE_ENV`), etiqueta `app` distingue el emisor (`medicitas-backend`, `medicitas-workers`, y en las APIs externas `farmacia-api`, `aseguradora-api` — las tres exponen el mismo patrón de logger). En Grafana → Explore → datasource Loki, query `{app="medicitas-backend"}`.

### Tracing distribuido (OpenTelemetry → Jaeger)

Los 3 servicios del ecosistema (medicitas-backend, farmacia-api, aseguradora-api) están instrumentados con el SDK Node de OpenTelemetry (`src/tracing.js`, requerido como **primera línea** de `server.js` — la auto-instrumentación debe instalarse antes de que `express`/`http`/`mysql2`/`amqplib` se carguen por primera vez). Auto-instrumenta HTTP, Express, MySQL2 y amqplib; el `correlationId` de cada request se adjunta como atributo de span (`correlation.middleware.js`) para poder cruzar un trace de Jaeger con sus logs en Loki.

Como las llamadas salientes (Axios) también quedan instrumentadas y propagan el contexto de trace (header `traceparent`), un flujo que cruza servicios —por ejemplo *validar cobertura* (medicitas-backend → aseguradora-api)— aparece como **un solo trace con spans de ambos servicios**, no como dos traces separados.

En Grafana → Explore → datasource Jaeger, o directo en http://localhost:16686 → buscar por servicio.

### Métricas (Prometheus)

`GET /metrics` (backend) expone métricas vía `prom-client`: contadores HTTP, histogramas de latencia, gauges de conexiones activas. Scrape config en `monitoring/prometheus.yml`.

---

## Seguridad ofensiva — OWASP ZAP

Escaneo baseline automatizado contra el gateway nginx (`http://nginx:80`), perfil Docker Compose separado (no se levanta con `docker compose up -d` normal):

```bash
docker compose --profile security run --rm zap
```

Genera reporte HTML + JSON en `./reports/zap/`. Las cabeceras de seguridad mitigadas en `nginx/nginx.conf` (`Content-Security-Policy`, `Permissions-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `server_tokens off`) responden directamente a hallazgos de ZAP (ver comentarios inline en el archivo: `# Soluciona 10038`, `# Soluciona 10036`, etc.).

---

## Infraestructura Docker

| Servicio | Imagen | Puerto host | Rol |
|---|---|---|---|
| `mysql` | mysql:8.0 | 3310→3306 | Base de datos (11 schemas lógicos) |
| `redis` | redis:7-alpine | 6379 | Caché de disponibilidad de médicos |
| `rabbitmq` | rabbitmq:3-management-alpine | 5672, 15672 | Broker de eventos |
| `backend` | build local (`Dockerfile`) | — (interno :3000) | API + consumers + SSE + Recovery Replay |
| `workers` | build local (`Dockerfile.workers`) | — | PM2: outbox, alertas-llegada |
| `nginx` | nginx:alpine | 80 | Gateway / reverse proxy |
| `prometheus` | prom/prometheus:v2.52.0 | 9090 | Métricas |
| `alertmanager` | prom/alertmanager:v0.27.0 | 9093 | Alertas |
| `loki` | grafana/loki:3.7.3 | 3100 | Logs |
| `jaeger` | jaegertracing/all-in-one:1.60 | 16686, 4317, 4318 | Tracing (almacenamiento en memoria — no persiste) |
| `grafana` | grafana/grafana:10.4.3 | 3001 | Dashboard unificado |
| `zap` | ghcr.io/zaproxy/zaproxy:stable | — | Escaneo de seguridad (perfil `security`, no arranca por defecto) |
| `autoheal` | willfarrell/autoheal | — | Reinicia automáticamente contenedores marcados `unhealthy` |

**Redes**: `medicitas_net` (bridge, interna al stack) + `medicitas_shared_net` (externa — conecta con `farmacia-api` y `aseguradora-prosalud-api`, que viven en sus propios `docker-compose.yml`; también usada por Loki/Jaeger para recibir logs/spans de esos dos servicios).

---

## Variables de entorno

Copiar `.env.example` → `.env`. Las más relevantes:

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `development` en local; controla logging pero **no** desactiva Loki (ver `LOKI_HOST`) |
| `MYSQL_*`, `REDIS_PASSWORD`, `RABBITMQ_USER/PASSWORD` | Credenciales de infraestructura |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Firma y expiración de tokens |
| `INTERNAL_SERVICE_TOKEN` | Bearer token S2S — bypasea RBAC y rate limiting |
| `USE_MOCK_SEGURO`, `USE_MOCK_FARMACIA`, `USE_MOCK_SMS` | Mock vs. integración real — **no cambiar sin confirmar con el equipo** |
| `ASEGURADORA_API_URL/KEY`, `FARMACIA_API_URL`, `FARMACIA_API_KEY` | Config de las 2 APIs externas |
| `CB_TIMEOUT_MS*`, `CB_ERROR_THRESHOLD*`, `CB_RESET_TIMEOUT_MS*` | Circuit Breaker (sufijo `_FARMACIA` para el de farmacia) |
| `RETRY_MAX_INTENTOS`, `RETRY_BASE_MS`, `RETRY_MAX_MS` | Retry + Full Jitter |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_AUTH_MAX` | Rate limiting (requests / 15 min) |
| `*_MAX_REINTENTOS` (`FAC_`, `NOT_`, `PRE_`, `AUD_`) | Tope de reintentos antes de DLQ por consumer |
| `REPLAY_FARMACIA_INTERVAL_MS`, `RECOVERY_LIMIT_FARMACIA` | Sondeo de Recovery Replay de farmacia |
| `LOKI_HOST`, `LOKI_APP_LABEL` | Activa el logging dual a Loki |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | Tracing distribuido |
| `GRAFANA_USER`, `GRAFANA_PASSWORD` | Acceso a Grafana |

---

## Instalación y ejecución

1. **Clonar y configurar**
   ```bash
   git clone https://github.com/Maczz09/medicitas-backend.git
   cd medicitas-backend
   cp .env.example .env
   ```

2. **Red compartida** (solo la primera vez — permite conectar con farmacia-api/aseguradora-api si están levantados por separado):
   ```bash
   docker network create medicitas_shared_net
   ```

3. **Levantar todo el stack**
   ```bash
   docker compose up -d
   ```
   Primera vez: tarda unos minutos (descarga imágenes + build de `backend`/`workers`).

4. **Verificar**
   - API + Swagger: http://localhost/api-docs/
   - Grafana: http://localhost:3001
   - Jaeger: http://localhost:16686
   - RabbitMQ: http://localhost:15672

---

## Comandos

### Ciclo de vida
```bash
docker compose up -d                    # Levantar todo el stack
docker compose up -d --build backend    # Reconstruir imagen y recrear solo backend
docker compose restart backend          # Reiniciar sin rebuild (hot-reload de ./src ya montado)
docker compose down                     # Apagar todo (conserva volúmenes/datos)
docker compose down -v                  # Apagar y borrar volúmenes (⚠️ pierde datos de MySQL/RabbitMQ/Grafana)
```

### Logs
```bash
docker logs -f medicitas_backend                 # Logs en vivo del backend
docker logs -f medicitas_workers                  # Logs en vivo de los workers PM2
docker logs --tail 100 medicitas_backend           # Últimas 100 líneas (incluye historial de reinicios previos)
```

### Base de datos
```bash
docker exec -it medicitas_mysql mysql -u root -p$MYSQL_ROOT_PASSWORD
```

### RabbitMQ
```bash
# Ver consumers activos por cola (requiere jq o similar para leer el JSON)
curl -u $RABBITMQ_USER:$RABBITMQ_PASSWORD http://localhost:15672/api/consumers/medicitas

# Ver estado/tasas de una cola específica
curl -u $RABBITMQ_USER:$RABBITMQ_PASSWORD http://localhost:15672/api/queues/medicitas/q.notificaciones
```

### Seguridad
```bash
docker compose --profile security run --rm zap   # Escaneo OWASP ZAP baseline → ./reports/zap/
```

### Desarrollo local sin Docker (requiere MySQL/Redis/RabbitMQ accesibles)
```bash
npm install
npm run dev:server     # nodemon src/server.js
npm run dev:workers    # nodemon workers/index.js
```

### Jaeger — consultar trazas por API
```bash
curl "http://localhost:16686/api/services"
curl "http://localhost:16686/api/traces?service=medicitas-backend&limit=5"
```
