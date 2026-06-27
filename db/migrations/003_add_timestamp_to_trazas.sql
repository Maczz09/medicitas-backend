-- Migración 003: agrega timestamp_origen a trazas_auditoria y hace correlation_id nullable
-- Ejecutar en despliegues existentes:
--   docker exec -i medicitas_mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" < db/migrations/003_add_timestamp_to_trazas.sql

USE svc_aud;

-- Agregar timestamp_origen si no existe
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'svc_aud' AND TABLE_NAME = 'trazas_auditoria' AND COLUMN_NAME = 'timestamp_origen'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE trazas_auditoria ADD COLUMN timestamp_origen DATETIME(3) NULL AFTER correlation_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Hacer correlation_id nullable (algunos eventos no tienen correlation)
ALTER TABLE trazas_auditoria MODIFY COLUMN correlation_id VARCHAR(36) NULL;
