-- Migración 001: agrega información del actor (usuario) a trazas_auditoria
-- Ejecutar una sola vez en despliegues existentes:
--   docker exec -i medicitas_mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" < db/migrations/001_add_actor_to_trazas.sql

USE svc_aud;

-- Agregar actor_id si no existe
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND COLUMN_NAME = 'actor_id'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE trazas_auditoria ADD COLUMN actor_id VARCHAR(36) NULL AFTER registrado_en',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Agregar actor_nombre si no existe
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND COLUMN_NAME = 'actor_nombre'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE trazas_auditoria ADD COLUMN actor_nombre VARCHAR(150) NULL AFTER actor_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Agregar actor_rol si no existe
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND COLUMN_NAME = 'actor_rol'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE trazas_auditoria ADD COLUMN actor_rol VARCHAR(50) NULL AFTER actor_nombre',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice en correlation_id si no existe
SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND INDEX_NAME = 'idx_correlation'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE trazas_auditoria ADD INDEX idx_correlation (correlation_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice en actor_id si no existe
SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND INDEX_NAME = 'idx_actor'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE trazas_auditoria ADD INDEX idx_actor (actor_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
