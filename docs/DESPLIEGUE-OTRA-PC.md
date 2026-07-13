# Desplegar estos cambios en la otra PC (sin problemas de compatibilidad)

Guía para propagar los cambios de esta sesión (PDFs en memoria, trazas
end-to-end por el outbox, unificación de la tabla `outbox`, healthcheck
profundo, rate-limit por usuario, limpieza de idempotencia, tests) a otra
máquina, dejándolo bien dockerizado.

## TL;DR

```bash
git pull

# --- BD: elige UNA de las dos rutas (ver abajo) ---
# Ruta A (recomendada, dev/test — recrea la BD desde init.sql):
docker compose down -v

# Ruta B (si necesitas CONSERVAR datos): aplicar la migración 005 UNA vez
#   (ver sección "Conservar datos")

# --- Levantar reconstruyendo las imágenes ---
docker compose up -d --build
```

`--build` es lo importante: reconstruye la imagen de `workers` (que copia el
`ecosystem.config.js` y el nuevo `limpieza_idempotencia.cron.js` en tiempo de
build) y la de `backend` (nuevo `src/`).

## Por qué NO habrá "problemas de compatibilidad como la otra vez"

El problema histórico era **drift entre `db/init.sql` y el esquema vivo**. En
esta sesión se corrigió: `init.sql` es de nuevo la fuente de verdad y quedó
alineado con el código.

**Verificado el 2026-07-12** levantando un MySQL 8.0 desechable con SOLO
`db/init.sql` (idéntico a lo que hace la otra PC con volumen nuevo): las 11
tablas `outbox` salen unificadas a la convención B (`id_evento / tipo_evento /
estado / intentos / correlation_id / creado_en / publicado_en / error_msg`),
con índice `idx_estado (estado, creado_en)`, y **cero columnas de la convención
vieja**. El `init.sql` corre sin errores cuando se le pasa `MYSQL_USER`
(como ya hace `docker-compose.yml` vía `.env`).

## Requisito del entorno (igual que hoy)

La otra PC necesita el mismo `.env` (o equivalente) — sobre todo:

- `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` — el entrypoint de MySQL
  crea el usuario `medicitas_app` con esas variables **antes** de correr
  `init.sql` (el `init.sql` hace `GRANT ... TO 'medicitas_app'`, que exige que el
  usuario ya exista). Sin `MYSQL_USER`, `init.sql` falla en la línea de GRANT.
- El resto de credenciales/URLs de servicios como ya están hoy.

## Ruta A — recrear la BD (recomendada para dev/test)

`docker compose down -v` borra los volúmenes, así que al `up` el `init.sql`
corre de cero y crea todo con el esquema ya unificado. Es la ruta más limpia y
la que garantiza cero drift.

Notas:
- Se pierden los datos sembrados/de prueba de esa PC (se regeneran del seed).
- **WhatsApp pedirá re-vincular** (QR nuevo) — es esperado al recrear el
  contenedor, no un bug. Ver `medicitas-local-env-gotchas`.

## Ruta B — conservar datos (aplicar la migración 005)

Si la otra PC ya tiene un volumen MySQL con datos que quieres conservar, su
esquema `outbox` es el VIEJO (dos convenciones) y `init.sql` no se re-ejecuta
sobre un volumen existente. Hay que aplicar la migración UNA vez:

```bash
# 1) parar el worker que usa el outbox
docker stop medicitas_workers

# 2) aplicar la migración (Git Bash / Linux / Mac):
docker cp db/migrations/005_unificar_outbox_convencion.sql medicitas_mysql:/tmp/005.sql
docker exec medicitas_mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" < /tmp/005.sql'

# 3) levantar reconstruyendo
docker compose up -d --build
```

> La 005 **solo** es válida sobre el esquema viejo (convención mixta). No la
> corras sobre una BD ya unificada o recién creada desde `init.sql` — fallaría
> (las columnas ya están renombradas). Para volúmenes nuevos, usa la Ruta A.

## Checklist de lo que se propaga con `git pull`

- Código: `src/`, `workers/` (incl. `traceContext.js`, `limpieza_idempotencia.cron.js`).
- `db/init.sql` corregido + `db/migrations/005_unificar_outbox_convencion.sql`.
- `ecosystem.config.js` (nuevo worker de limpieza).
- `docker-compose.yml` (sin los volúmenes `*_storage`, ya no se usan).
- `package.json` + `package-lock.json` (jest como devDependency; **en sync**,
  así que `npm ci --only=production` del build no se rompe — y jest no entra en
  la imagen, es solo para `npm test` en el host).
- `tests/` (68 tests). Correrlos en la otra PC: `npm install` y `npm test`.

## Verificación rápida post-deploy (en la otra PC)

```bash
# healthcheck profundo (debe dar READY con mysql/redis/rabbitmq up)
docker exec medicitas_backend wget -qO- http://localhost:3000/health/ready

# esquema outbox unificado (11 tablas, todas con id_evento/estado)
docker exec medicitas_mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e \
  "SELECT COUNT(DISTINCT TABLE_SCHEMA) FROM information_schema.columns \
   WHERE table_name=\"outbox\" AND column_name=\"id_evento\";"'   # → 11

# tests
npm install && npm test    # → 68 passed
```
