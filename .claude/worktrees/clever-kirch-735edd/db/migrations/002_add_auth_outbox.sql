-- Migración 002: crea la tabla outbox en medicitas_users para trazabilidad de Auth
-- Ejecutar una sola vez en despliegues existentes:
--   docker exec -i medicitas_mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" < db/migrations/002_add_auth_outbox.sql

USE medicitas_users;

CREATE TABLE IF NOT EXISTS outbox (
  id_evento     VARCHAR(36)  NOT NULL,
  tipo_evento   VARCHAR(100) NOT NULL,
  payload       JSON         NOT NULL,
  estado        ENUM('PENDIENTE', 'PUBLICADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  intentos      INT          NOT NULL DEFAULT 0,
  correlation_id VARCHAR(36) NOT NULL,
  creado_en     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publicado_en  TIMESTAMP    NULL,
  error_msg     TEXT,
  PRIMARY KEY (id_evento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
