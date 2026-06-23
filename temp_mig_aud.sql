CREATE DATABASE IF NOT EXISTS svc_aud;
USE svc_aud;

-- ── Tabla única e inmutable ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trazas (
  id              VARCHAR(36)   NOT NULL,      -- PK propia de Auditoría (uuid v4)
  id_evento       VARCHAR(36)   NOT NULL,      -- idEvento original del emisor (para idempotencia)
  servicio_origen VARCHAR(50)   NOT NULL,      -- ej: 'svc_cit', 'svc_pag'
  tipo_evento     VARCHAR(60)   NOT NULL,      -- ej: 'CitaCreada', 'PagoAprobado'
  routing_key     VARCHAR(100)  NOT NULL,      -- ej: 'citas.CitaCreada'
  payload         JSON          NOT NULL,      -- Payload crudo del evento, sin transformar
  correlation_id  VARCHAR(36)   NULL,
  timestamp_origen DATETIME     NULL,          -- timestamp incluido por el emisor
  recibido_en     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_id_evento (id_evento),         -- Idempotencia: mismo evento no se duplica
  INDEX idx_tipo_evento    (tipo_evento),
  INDEX idx_servicio       (servicio_origen),
  INDEX idx_correlation    (correlation_id),
  INDEX idx_recibido       (recibido_en)
);

-- Permisos
GRANT SELECT, INSERT ON svc_aud.trazas TO 'medicitas_app'@'%';
FLUSH PRIVILEGES;
