# Auditoría de mejoras — MediCitas

Lista priorizada de mejoras detectadas durante el trabajo de carga/observabilidad.
Ordenadas por relación **impacto / esfuerzo**. No son bugs (el sistema funciona);
son oportunidades para robustez, rendimiento y mantenibilidad.

## P1 — Alto impacto

### 1. Trazas end-to-end conectadas (propagación de `traceparent` por el outbox)
**Qué:** hoy en Jaeger el flujo `cita → pago → seguro → factura → notificación`
aparece como **trazas separadas** (una por request HTTP, otra por el worker de
outbox, otra por cada consumer), todas buscables por el tag `correlationId` pero
no unidas en una sola cascada. La causa: el patrón outbox escribe el evento a una
tabla MySQL y un worker aparte lo publica a RabbitMQ, rompiendo la propagación
automática del contexto de trace.
**Cómo:** (a) agregar columna `traceparent` a las 11 tablas `outbox`; (b) al
insertar el evento, capturar el contexto activo con la API de OTel
(`propagation.inject`) y guardarlo — toca los 8 `OutboxMySQLPublisher`; (c) en
`workers/outbox.worker.js`/`rabbitmq.publishEvent`, inyectar ese `traceparent` en
los headers del mensaje; (d) en los 5 consumers, extraer el contexto y ejecutar el
handler dentro de él. **Esfuerzo:** alto (~16 archivos + migración). **Riesgo:**
medio (toca el pipeline crítico de eventos) — hacerlo como tarea aislada y probada.
> Mientras tanto, el flujo YA es auditable end-to-end por `correlationId` en Loki
> (logs) y en Jaeger (buscando el tag). Esto solo lo convierte en una sola cascada.

### 2. Limpieza de `medicitas_users.peticiones_idempotentes`
**Qué:** la tabla de idempotencia **crece sin límite** (cada POST con
`Idempotency-Key` inserta una fila con el `response_body` completo; las pruebas
de carga dejaron ~15k filas). Con el tiempo degrada los `SELECT` de idempotencia
y ocupa disco.
**Cómo:** un cron (en el contenedor `workers`, junto a los otros) que borre filas
con `created_at` más viejo que N horas: `DELETE FROM ... WHERE created_at < NOW() - INTERVAL 24 HOUR`.
**Esfuerzo:** bajo. **Impacto:** evita degradación a largo plazo.

### 3. Healthcheck profundo
**Qué:** `GET /health` (`src/app.js`) solo devuelve `{status:'OK'}` sin verificar
dependencias. Docker lo cree "healthy" aunque MySQL/Redis/RabbitMQ estén caídos.
**Cómo:** un `/health` (o `/health/ready`) que haga `SELECT 1`, `redis.ping()` y
compruebe el canal de RabbitMQ, devolviendo 503 si algo falla. Mantener un
`/health/live` liviano para el liveness.
**Esfuerzo:** bajo. **Impacto:** el autoheal y los orquestadores reaccionan de verdad.

## P2 — Impacto medio

### 4. N+1 en el listado de encuentros clínicos
**Qué:** `EncuentroMySQLRepository.findPaginadoByExpediente` hace **una query de
prescripciones por cada encuentro** del page (N+1). Con muchos encuentros, se
dispara la latencia.
**Cómo:** una sola query con `WHERE id_encuentro IN (...)` y agrupar en memoria.
**Esfuerzo:** bajo-medio.

### 5. PDFs generados a disco (viola la regla "todo en memoria")
**Qué:** `PDFKitGenerator` (facturación) y `RecetaPDFGenerator` (prescripciones)
usan `fs.createWriteStream` + volúmenes Docker. La regla del proyecto es no tocar
disco (cuello de I/O bajo concurrencia).
**Cómo:** acumular los chunks de pdfkit en memoria (`doc.on('data')`) y regenerar
el PDF al vuelo en la ruta de descarga desde los datos ya persistidos.
**Esfuerzo:** medio (2 módulos).

### 6. Código muerto: `src/modules/notificaciones/workers/notificaciones.consumer.js`
**Qué:** no está cableado (PM2 no lo corre), manda emails falsos a
`paciente@example.com` y tiene un `INSERT` con columna `tipo_evento` que no existe
en `eventos_procesados`. Confunde y es una trampa latente.
**Cómo:** borrarlo. **Esfuerzo:** trivial.

### 7. Pool de conexiones vs. workers (documentar la regla)
**Qué:** con clustering, cada worker crea su propio pool → total = `WEB_CONCURRENCY
× DB_POOL_SIZE`. Ya está right-sized para carga (6×8), pero conviene dejar la
regla escrita en el código/README para que nadie vuelva a poner 10×20 y sature
MySQL (fue la causa del primer estancamiento).
**Esfuerzo:** trivial (ya documentado en el override; reforzar).

## P3 — Higiene / mantenibilidad

### 8. Sin suite de tests automatizados
**Qué:** no hay `*.test.js`/`*.spec.js` ni script `test`. Los casos de uso
(resolución de horario, cálculo de slots, tolerancia de citas, idempotencia) son
lógica pura ideal para tests unitarios.
**Cómo:** Jest + tests de los use-cases y value-objects más críticos.
**Esfuerzo:** medio-alto (incremental).

### 9. Dos convenciones de tabla `outbox` (A y B)
**Qué:** conviven `id/evento/publicado` y `id_evento/tipo_evento/estado`. El worker
las auto-detecta, pero unificar reduce complejidad y sorpresas.
**Esfuerzo:** medio.

### 10. Rate limiting por IP (no por usuario)
**Qué:** el límite es por `binary_remote_addr`. Detrás de un NAT/proxy, muchos
usuarios comparten IP. Considerar límite por token/usuario para las rutas sensibles.
**Esfuerzo:** bajo-medio.

## Ya hecho en esta sesión (no repetir)
- Right-size del pool + índice `(activo, created_at)` + query de pacientes sin
  `SQL_CALC_FOUND_ROWS` → el 1M pasa al 100%.
- OTel apagado/muestreado en carga → estabilidad de WSL2.
- Log de acceso por request → todas las peticiones en Loki.
- Catch-all 404 + `docs/MANEJO-ERRORES.md`.
- Kill-switch en Redis para resiliencia por servicio.
