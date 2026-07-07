# Registro de incidentes — MediCitas

Catálogo de problemas reales encontrados durante el desarrollo del ecosistema MediCitas (`medicitas-backend`, `farmacia-api`, `aseguradora-prosalud-api`, `medicitas-frontend`, `seguros-fallback-service`), su causa raíz, la solución aplicada y qué se hizo para que no vuelva a pasar. Se documentan solo incidentes reales — algo que se rompió, se diagnosticó y se corrigió — no mejoras proactivas (esas viven en el informe de auditoría y en `VERSIONING.md`).

---

## 1. Saturación de Jaeger por reintento infinito en consumers de RabbitMQ

**Síntoma**: Jaeger acumulaba un volumen de spans desproporcionado; varios consumers de RabbitMQ (Notificaciones, Prescripciones, Facturación, Auditoría) parecían reprocesar el mismo mensaje indefinidamente sin nunca enviarlo a la dead-letter-queue.

**Causa raíz**: RabbitMQ **no puebla `x-delivery-count`** en colas clásicas (solo en quorum queues). El patrón `channel.nack(msg, false, true)` reencola el mensaje sin incrementar ningún contador visible para la app — el umbral de "máximos reintentos → DLQ" nunca se alcanzaba porque no había forma de contar los intentos.

**Solución**: cada consumer rastrea su propio contador de reintentos con un header custom (`x-retry-count`) que viaja con el mensaje. Como no se puede reescribir un header de un mensaje ya reencolado vía `nack`, el patrón es: `ack()` el mensaje original + `publish()` una copia nueva con `x-retry-count` incrementado. Al alcanzar `MAX_REINTENTOS` (3, configurable por env var), se hace `nack(msg, false, false)` para enviarlo a la DLQ vía dead-letter-exchange de la cola.

**Prevención**: el patrón quedó estandarizado en los 4 consumers (`NotificacionesConsumer`, `PrescripcionesConsumer`, y equivalentes en facturación/auditoría) — cualquier consumer nuevo debe copiarlo en vez de asumir que `nack(requeue=true)` es suficiente.

---

## 2. Decoder JSON de Loki incompatible con pino-loki 3.x

**Síntoma**: los logs estructurados dejaban de llegar a Grafana/Loki intermitentemente, con el batch completo perdido en vez de solo la línea problemática.

**Causa raíz**: Loki 2.9.4 traía un decoder de `/loki/api/v1/push` demasiado estricto para el formato que envía `pino-loki` 3.x — un solo campo con forma inesperada corrompía el batch entero (`unmarshalerDecoder...`).

**Solución**: actualizar la imagen de Loki a `grafana/loki:3.7.3`, que acepta el formato de `pino-loki` 3.x sin problema.

**Prevención**: versión de Loki fijada explícitamente en `docker-compose.yml` (no `latest`), con un comentario en el propio archivo explicando por qué esa versión específica importa.

---

## 3. API key de webhooks hardcodeada en el código

**Síntoma**: hallazgo de auditoría de seguridad — el valor `'test-api-key-12345'` aparecía escrito directamente en el código fuente como fallback de la clave de autenticación de webhooks, en vez de leerse exclusivamente de una variable de entorno.

**Causa raíz**: un fallback de desarrollo que nunca se retiró antes de considerar el código listo para producción. Cualquiera con acceso al repositorio (o a un `git blame`) tenía la clave real de autenticación de los webhooks.

**Solución**: `verifyWebhookApiKey.middleware.js` se reescribió para ser **fail-closed** — si la variable de entorno esperada no está configurada, la petición se rechaza con 503 en vez de aceptar cualquier valor o caer a un hardcode. Coordinado con el cambio de header (`x-api-key` → `X-Webhook-Api-Key`) documentado en `VERSIONING.md` §3.1.

**Prevención**: ningún middleware de autenticación en el proyecto debe tener un valor por defecto que no sea "rechazar todo". Revisado como parte del checklist de auditoría de seguridad de esta sesión.

---

## 4. Bug de `LIMIT` como placeholder en mysql2 (OutboxWorker de aseguradora-api)

**Síntoma**: los eventos del outbox de `aseguradora-prosalud-api` nunca llegaban a RabbitMQ — el worker corría sin errores visibles pero no publicaba nada, acumulando un backlog silencioso.

**Causa raíz**: la query usaba `LIMIT ?` con el valor pasado como parámetro placeholder de mysql2. El driver mysql2 no soporta `LIMIT`/`OFFSET` como placeholders preparados de la misma forma que otros valores — la query fallaba (o, según la versión, se comportaba de forma inesperada) de manera silenciosa dentro del try/catch del worker.

**Solución**: interpolar `LIMIT` directamente en el string de la query (ya validado como entero antes de interpolar, no viene de input de usuario) en vez de pasarlo como placeholder.

**Prevención**: al desplegar el fix, se drenó de una sola vez el backlog de eventos acumulado — un evento observable pero esperado (no una ruptura de contrato, ver `VERSIONING.md` §4). Este patrón (`LIMIT`/`OFFSET` interpolados, nunca como placeholder) se replicó consistentemente en los workers nuevos de esta sesión (`workers/outbox.worker.js`, reconciliación de `seguros-fallback-service`).

---

## 5. Pérdida de sesión de WhatsApp por `--force-recreate`

**Síntoma**: tras recrear el contenedor `medicitas_backend` (`docker compose up -d --force-recreate` o equivalente), WhatsApp Web dejaba de responder y pedía escanear un código QR nuevo, perdiendo la vinculación existente.

**Causa raíz**: el perfil de Chromium de `whatsapp-web.js` (`LocalAuth`) vive en un volumen bind-mounted que persiste entre recreaciones de contenedor, pero los archivos `SingletonLock`/`SingletonSocket`/`SingletonCookie` identifican la instancia de Chromium por PID/hostname del contenedor **anterior**. Al recrear el contenedor esos PIDs ya no existen, pero Chromium detecta el lock como "vivo" y se cuelga esperando resolverlo — nunca llega a emitir el evento `qr` ni `ready`.

**Solución**: `limpiarLocksHuerfanos()` se ejecuta antes de cada arranque de `initClient()`, eliminando esos 3 archivos de lock si existen. Si aun así fallan 2 intentos de inicialización seguidos, se asume que el perfil está corrupto más allá de los locks (LevelDB/IndexedDB dañadas por un apagado no gracioso) y se borra la sesión completa automáticamente (`_borrarSesionCorrupta()`) — perder la vinculación y requerir un nuevo QR es preferible a un servicio de notificaciones muerto indefinidamente.

**Prevención**: apagado gracioso registrado (`SIGTERM`/`SIGINT` → `client.destroy()` antes de salir) para minimizar la frecuencia con la que el perfil se corrompe en primer lugar. **Nota operativa**: este incidente se repitió durante la sesión de v2.1.0 (`docker compose up -d backend` para adjuntar el volumen `recetas_storage` nuevo triggereó el mismo conflicto de lock) — es un efecto secundario esperado de recrear ese contenedor específico, no un bug nuevo. Requiere volver a escanear el QR después de cualquier recreación del contenedor `backend`.

---

## 6. Drift de esquema: `svc_seg.validaciones_cobertura` (`init.sql` desincronizado)

**Síntoma**: descubierto al investigar el diseño del fallback de cobertura — `db/init.sql` definía la tabla con PK `id_validacion`, sin las columnas `es_fallback`/`correlation_id`, y con una columna `respuesta_raw JSON` que no existe en la base viva.

**Causa raíz**: `ALTER TABLE`s aplicados directamente contra la base de datos en ejecución en sesiones anteriores, sin reflejar el cambio de vuelta en `init.sql`. Un despliegue nuevo desde cero (`docker compose up` con el volumen de MySQL vacío) habría creado una tabla con la forma vieja, incompatible con `CoberturasMySQLRepository.js`.

**Solución**: `DESCRIBE`/`SHOW INDEX` contra la base viva como fuente de verdad; `init.sql` reescrito para coincidir exactamente (PK `id`, columnas y tipos correctos, los 3 índices reales).

**Prevención**: ver incidentes 7 y 8 — el mismo patrón se repitió en `svc_pre`, lo que sugiere que **`init.sql` no se ha mantenido al día de forma sistemática**. Recomendación a futuro: cualquier `ALTER TABLE` manual contra la base viva debe reflejarse en el mismo commit en `init.sql`, o preferir migraciones versionadas en vez de `ALTER`s ad-hoc.

---

## 7. Drift de esquema: `svc_pre.despachos` (nombre y columnas completamente distintos en `init.sql`)

**Síntoma**: descubierto durante la implementación de la contingencia de farmacia — `init.sql` definía una tabla `despachos_receta` (PK `id_receta`, columnas `id_prescripcion`/`farmacia_id`/`intentos`), mientras que el código (`DespachosMySQLRepository.js`) y la base viva usan una tabla llamada `despachos` con columnas distintas (`id`, `id_evento_origen`, `contenido`, `fecha_despacho`, `referencia_farmacia`, `intentos_envio`, etc.).

**Causa raíz**: la misma que el incidente 6 — el módulo de prescripciones evolucionó su esquema en vivo sin que `init.sql` se actualizara. En este caso el drift era total (nombre de tabla distinto), no parcial.

**Solución**: `SHOW CREATE TABLE svc_pre.despachos` contra la base viva; `init.sql` corregido para coincidir exactamente.

**Prevención**: igual que el incidente 6. Un despliegue nuevo desde `init.sql` sin esta corrección habría roto el módulo de prescripciones desde el primer arranque.

---

## 8. Drift de esquema: `svc_pre.outbox` usaba la convención de columnas equivocada

**Síntoma**: en la misma revisión del incidente 7, se encontró que `init.sql` definía `svc_pre.outbox` con las columnas `id_evento`/`tipo_evento`/`estado` (una de las dos convenciones que conviven en el proyecto — ver `workers/outbox.worker.js`), pero la tabla viva y `OutboxEventPublisher.js` de prescripciones usan la otra convención (`id`/`evento`/`publicado`).

**Causa raíz**: el proyecto tiene, por diseño histórico, **dos convenciones distintas** de columnas para las tablas outbox de cada esquema (`workers/outbox.worker.js` detecta cuál usa cada una en tiempo de ejecución vía `INFORMATION_SCHEMA`). `init.sql` para `svc_pre` fue escrito copiando la convención equivocada.

**Solución**: `init.sql` corregido para usar la convención A (`id`/`evento`/`publicado`/`intentos`/`created_at`), verificada contra `SHOW CREATE TABLE svc_pre.outbox` en la base viva.

**Prevención**: documentado explícitamente con un comentario en `init.sql` junto a la tabla, indicando qué convención usa y por qué difiere de las demás — para que la próxima persona que edite ese archivo no la "corrija" hacia la convención equivocada por consistencia visual con las otras tablas outbox del mismo archivo.

---

## 9. `svc_not.mensajes_sms.estado` no soportaba `PENDIENTE_VINCULACION` — notificaciones perdidas silenciosamente

**Síntoma**: descubierto al probar la contingencia de farmacia end-to-end con la sesión de WhatsApp desvinculada (ver incidente 5). El evento se publicaba correctamente a RabbitMQ y el consumer de Notificaciones lo procesaba, pero fallaba con `Error al guardar mensaje SMS` y terminaba en la DLQ tras 3 reintentos.

**Causa raíz**: el ENUM `estado` de la tabla viva `svc_not.mensajes_sms` solo incluía `'PENDIENTE'`, `'ENVIADO'`, `'FALLIDO'` — pero `MensajeSMS.crearPendienteVinculacion()` (invocado exactamente cuando WhatsApp no está vinculado, vía `WhatsAppNotLinkedError`) construye una entidad con `estado = 'PENDIENTE_VINCULACION'`, un valor que MySQL rechazaba por no pertenecer al ENUM. El error real quedaba oculto porque el repositorio captura la excepción de MySQL y la reemplaza por un `DomainError` genérico sin loguear el mensaje original.

**Impacto real**: esto significa que, **desde que existe la funcionalidad de reenvío automático al reconectar WhatsApp** (`ProcesarMensajesPendientesUseCase`, disparado en el callback `onReady`), nunca tuvo nada que reenviar — ningún mensaje intentado durante una desconexión de WhatsApp llegó a persistirse como `PENDIENTE_VINCULACION`, así que no había nada que recuperar al reconectar. Cualquier notificación (cita creada, comprobante emitido, etc.) que cayera en una ventana de WhatsApp desvinculado se perdía sin registro ni reintento.

**Solución**: `ALTER TABLE svc_not.mensajes_sms MODIFY COLUMN estado ENUM('PENDIENTE','ENVIADO','FALLIDO','PENDIENTE_VINCULACION') ...` aplicado en vivo; `init.sql` corregido en paralelo (también le faltaban las columnas `id_paciente` y `referencia_gateway`, que el repositorio sí escribe).

**Prevención**: verificado end-to-end tras el fix — un mensaje generado con WhatsApp desvinculado ahora persiste correctamente como `PENDIENTE_VINCULACION` en vez de ir a la DLQ. Recomendación a futuro: cuando un repositorio captura la excepción real de MySQL y la reemplaza por un error genérico (patrón usado en varios repositorios de este proyecto para no filtrar detalles de infraestructura al cliente HTTP), el mensaje original debe quedar al menos en el log interno (`logger.error`) antes de lanzar el `DomainError` — aquí no quedaba rastro de qué había fallado realmente, lo que alargó el diagnóstico.

---

## 10. Body vacío/malformado en el webhook de seguros devuelve 500 en vez de 400

**Síntoma**: encontrado al verificar que el nuevo auth de servicio (client-credentials) funciona igual de bien que la API key estática en los webhooks — una petición con body `{}` a `POST /api/v2/webhooks/seguros` devuelve `500 ERROR_INTERNO` en vez de un `400` de validación.

**Causa raíz**: a diferencia del webhook de farmacia (que valida explícitamente `if (!idReceta || !estado) return res.status(400)...` antes de procesar), el handler del webhook de seguros no valida la presencia de los campos requeridos antes de usarlos — confirmado que ocurre igual con la autenticación vieja y la nueva, así que no es un problema de autenticación.

**Solución**: `WebhookController.recibirWebhook` ahora valida explícitamente que `nuevoEstado` esté presente y que venga al menos uno de `idValidacion`/`numeroPoliza` (los campos que `ProcesarWebhookAseguradoraUseCase` realmente usa como bind params), devolviendo `400 { codigo: 'DATOS_INCOMPLETOS', ... }` antes de invocar el caso de uso — mismo patrón de guard clause que el webhook de farmacia, con el envelope (`codigo`/`mensaje`/`correlationId`/`timestamp`) que ya usaba el propio módulo de seguros en `/interno/eventos-fallback`.

**Prevención**: al agregar cualquier endpoint que reciba un body externo, validar explícitamente los campos requeridos antes de leerlos — patrón ya replicado en ambos webhooks (farmacia y seguros).
