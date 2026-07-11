# Manejo de errores — MediCitas

Toda respuesta de error de la API sale con el **mismo envelope JSON**, sin
importar el módulo, la capa o el tipo de fallo. Nunca se devuelve HTML, ni
stack traces, ni SQL, ni detalles internos al cliente.

## Envelope estándar

```json
{
  "codigo": "CITA_NO_ENCONTRADA",
  "mensaje": "No existe una cita con ese id.",
  "detalles": [ { "campo": "fecha_hora", "mensaje": "es obligatorio" } ],
  "correlationId": "88dfbd5a-c683-4664-83ef-c0d175ec8544",
  "timestamp": "2026-07-11T06:57:01.502Z"
}
```

| Campo | Siempre | Descripción |
|-------|:------:|-------------|
| `codigo` | sí | Código estable y legible (SCREAMING_SNAKE_CASE). Para el cliente/tests. |
| `mensaje` | sí | Texto para humanos. En 5xx es genérico (no filtra el detalle interno). |
| `detalles` | no | Solo en errores de validación: array de `{ campo, mensaje }`. |
| `correlationId` | sí | Cruza esta respuesta con sus logs en Loki y su traza en Jaeger. |
| `timestamp` | sí | ISO-8601 UTC. |

Todo lo centraliza `src/shared/infrastructure/error.middleware.js` (el último
middleware de `app.js`). Los controladores solo lanzan/derivan el error; el
formato de salida es responsabilidad de esa única capa.

## Capas de manejo (de fuera hacia adentro)

1. **Ruta inexistente → 404 `RUTA_NO_ENCONTRADA`.** Un catch-all al final de
   `app.js` responde el envelope estándar en vez del `Cannot GET ...` en HTML de
   Express. Cualquier typo o endpoint que no existe recibe JSON consistente.
2. **JSON malformado → 400 `JSON_MALFORMADO`.** `express.json()` lanza
   `entity.parse.failed`; el handler lo traduce sin revelar posición/estructura
   del parser. (Enviar un body con una coma de más, una llave sin cerrar, o —como
   en la prueba del profe— un campo duplicado con sintaxis rota cae aquí.)
3. **Autenticación → 401 `TOKEN_REQUERIDO` / token inválido.** `auth.middleware`
   rechaza antes de llegar al controlador.
4. **Autorización → 403 `ROL_INSUFICIENTE`.** `rbac.middleware` (requireRole) y
   `resourceAuth.middleware` (dueño del recurso).
5. **Validación de entrada → 400/422 con `detalles`.** Los esquemas de validación
   por módulo producen el array `{ campo, mensaje }`.
6. **Reglas de negocio → `DomainError`.** Cada caso de uso lanza un `DomainError`
   con su `codigo`, `status` y `mensaje` (ver catálogo abajo).
7. **Servicio dado de baja → 503 `SERVICIO_..._NO_DISPONIBLE`.** El kill-switch
   (`killSwitch.middleware`) para pruebas de resiliencia.
8. **Cualquier excepción no controlada → 500 `ERROR_INTERNO`.** Se loguea del lado
   servidor con stack + `correlationId`; al cliente se le da un mensaje genérico.
   Nunca se filtra `err.message`, stack ni SQL.

## `DomainError` — dos convenciones soportadas

`src/shared/domain/errors.js` acepta las dos formas que conviven en el proyecto
(detecta cuál argumento es el número de status):

```js
new DomainError('CITA_NO_ENCONTRADA', 'No existe la cita.', 404)       // codigo, mensaje, status
new DomainError('PAGO_DUPLICADO', 409, 'Pago ya registrado.')          // codigo, status, mensaje
```

Subclases útiles: `ValidationError` (400), y las `*NotFoundError` / `*ConflictError`
por dominio. El `error.middleware` mapea `status`, `codigo`, `mensaje` y `detalles`
directo al envelope.

## Catálogo de códigos por servicio (representativo)

| Servicio | Códigos (HTTP) |
|----------|----------------|
| **Citas** | `CITA_NO_ENCONTRADA` (404), `TRANSICION_INVALIDA` (409), `CITA_NO_EN_ATENCION` (409), `CITA_NO_PAGADA`/`CITA_SIN_PAGO_VIGENTE` (409), `SERVICIO_CITAS_NO_DISPONIBLE` (503) |
| **Pacientes** | `PACIENTE_NO_ENCONTRADO` (404), `PAGINACION_INVALIDA` (400), `DATOS_INVALIDOS` (400/422), `SERVICIO_PACIENTES_NO_DISPONIBLE` (503) |
| **Pagos** | `PAGO_NO_ENCONTRADO` (404), `PAGO_DUPLICADO` (409), `MONTO_INVALIDO` (400), `TRANSICION_INVALIDA` (409), `ERROR_INTERNO_PAG` (500) |
| **Seguros** | `COBERTURA_NO_VALIDADA` (409), `VALIDACION_NO_ENCONTRADA` (404), `ERROR_ADAPTADOR_EXTERNO` (502/503), `ERROR_INTERNO_SEG` (500) |
| **Facturación** | `COMPROBANTE_NO_ENCONTRADO` (404), `COMPROBANTE_DUPLICADO` (409), `ERROR_GENERACION_PDF` (500), `PDF_NO_DISPONIBLE` (404), `ERROR_INTERNO_FAC` (500) |
| **Prescripciones** | `RECETA_NO_ENCONTRADA` (404), `RECETA_NO_DESPACHADA` (409), `RECETA_NO_RECHAZADA` (409), `RECETA_CONTINGENCIA_NO_ENCONTRADA` (404), `ESTADO_WEBHOOK_INVALIDO` (400) |
| **Historia Clínica** | `EXPEDIENTE_NO_ENCONTRADO` (404), `ERROR_INTERNO_HCL` (500) |
| **Notificaciones** | `PACIENTE_SIN_TELEFONO` (422), `ERROR_INTERNO_NOT` (500) |
| **Auth/Usuarios** | `TOKEN_REQUERIDO` (401), `ROL_INSUFICIENTE` (403), `USER_CONFLICT` (409) |
| **Transversal** | `RUTA_NO_ENCONTRADA` (404), `JSON_MALFORMADO` (400), `PARAMETRO_REQUERIDO` (400), `IDEMPOTENCY_KEY_REQUERIDA` (400), `PETICION_EN_PROCESO` (409), `ERROR_INTERNO` (500) |

## Trazabilidad (lo que pide auditar el profe)

Cada error lleva `correlationId`. El mismo id viaja en:
- El **log estructurado** en Loki (`{app="medicitas-backend"} | json | correlationId="..."`).
- La **traza distribuida** en Jaeger (atributo de span).

Así, de una respuesta de error 4xx/5xx el cliente ve el `correlationId`, y con
ese id se reconstruye TODA la petición de punta a punta (qué módulos tocó, qué
falló, con qué mensaje) — sin exponer nada sensible al cliente.

Regla de logging: **5xx = `logger.error` con stack** (falla real a investigar);
**4xx = `logger.warn` sin stack** (rechazo esperable, p. ej. validación o 404).

## Cómo probarlo (ejemplos que el profe podría tirar)

```bash
# Ruta inexistente → 404 JSON (ya no "Cannot GET")
curl -i http://localhost/api/v2/noexiste

# JSON malformado → 400 JSON_MALFORMADO
curl -i -X POST http://localhost/api/v2/citas -H "Content-Type: application/json" -d '{ roto,, }'

# Sin token → 401 TOKEN_REQUERIDO
curl -i -X POST http://localhost/api/v2/citas -H "Content-Type: application/json" -d '{}'

# Rol insuficiente → 403 ROL_INSUFICIENTE (token de Recepcionista a un endpoint de Médico)
curl -i http://localhost/api/v2/historias-clinicas/<id>/resumen -H "Authorization: Bearer <token-recepcion>"

# Recurso inexistente → 404 <RECURSO>_NO_ENCONTRADO
curl -i http://localhost/api/v2/pacientes/no-existe -H "Authorization: Bearer <token>"
```

Todas responden el mismo envelope `{ codigo, mensaje, correlationId, timestamp }`.
