-- Migración 005: unificar las DOS convenciones de tabla outbox en UNA (la B).
--
-- Hasta ahora convivían:
--   A: id / evento / publicado (0|1) / created_at          → svc_cit, svc_fac,
--      svc_hor, svc_not, svc_pre, svc_seg
--   B: id_evento / tipo_evento / estado (PENDIENTE|PUBLICADO|FALLIDO) /
--      creado_en / publicado_en / error_msg                → medicitas_users,
--      svc_hcl, svc_med, svc_pac, svc_pag
-- y workers/outbox.worker.js auto-detectaba cuál usaba cada esquema.
--
-- Se unifica hacia B (más expresiva: estado con FALLIDO, timestamp de
-- publicación, mensaje de error) y se elimina la auto-detección del worker.
--
-- Además se agrega el índice (estado, creado_en) a TODAS las tablas outbox:
-- el worker consulta `WHERE estado = 'PENDIENTE' ORDER BY creado_en` cada 5
-- segundos y las tablas B nunca tuvieron índice para eso (la lección del
-- índice (activo, created_at) en pacientes durante las pruebas de carga).
--
-- NOTA: correr UNA sola vez sobre BDs creadas antes de esta migración (el
-- db/init.sql actual ya crea todas las tablas con la convención unificada).
-- Parar el contenedor `workers` antes y reiniciar `backend` y `workers`
-- después, para que ningún proceso siga usando las columnas viejas.

-- ── Tablas con convención A → renombrar/convertir a B ────────────────────────

-- svc_cit
ALTER TABLE svc_cit.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_cit.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_cit.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- svc_fac
ALTER TABLE svc_fac.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_fac.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_fac.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- svc_hor
ALTER TABLE svc_hor.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_hor.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_hor.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- svc_not
ALTER TABLE svc_not.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_not.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_not.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- svc_pre
ALTER TABLE svc_pre.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_pre.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_pre.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- svc_seg
ALTER TABLE svc_seg.outbox
  ADD COLUMN estado ENUM('PENDIENTE','PUBLICADO','FALLIDO') NOT NULL DEFAULT 'PENDIENTE' AFTER payload,
  ADD COLUMN publicado_en TIMESTAMP NULL,
  ADD COLUMN error_msg TEXT NULL;
UPDATE svc_seg.outbox SET estado = 'PUBLICADO' WHERE publicado = 1;
ALTER TABLE svc_seg.outbox
  DROP INDEX idx_publicado,
  DROP COLUMN publicado,
  RENAME COLUMN id TO id_evento,
  CHANGE COLUMN evento tipo_evento VARCHAR(100) NOT NULL,
  RENAME COLUMN created_at TO creado_en,
  ADD INDEX idx_estado (estado, creado_en);

-- ── Tablas que ya eran B → solo agregar el índice del worker ─────────────────

ALTER TABLE medicitas_users.outbox ADD INDEX idx_estado (estado, creado_en);
ALTER TABLE svc_hcl.outbox          ADD INDEX idx_estado (estado, creado_en);
ALTER TABLE svc_med.outbox          ADD INDEX idx_estado (estado, creado_en);
ALTER TABLE svc_pac.outbox          ADD INDEX idx_estado (estado, creado_en);
ALTER TABLE svc_pag.outbox          ADD INDEX idx_estado (estado, creado_en);
