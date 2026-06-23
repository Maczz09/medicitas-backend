CREATE DATABASE IF NOT EXISTS svc_not;
USE svc_not;

CREATE TABLE IF NOT EXISTS mensajes_sms (
  id              VARCHAR(36)   NOT NULL,         -- UUID v4 local (PK propia de Notificaciones)
  id_evento       VARCHAR(36)   NOT NULL,         -- idEvento original — UNIQUE para idempotencia
  tipo_evento     VARCHAR(60)   NOT NULL,         -- ej: 'CitaCreada', 'AlertaRetraso'
  id_paciente     VARCHAR(20)   NOT NULL,
  telefono        VARCHAR(15)   NOT NULL,         -- Número al que se intentó enviar
  mensaje         TEXT          NOT NULL,         -- Texto exacto del SMS enviado
  estado          ENUM('ENVIADO','FALLIDO') NOT NULL,
  referencia_gateway VARCHAR(100) NULL,           -- ID/referencia devuelta por el gateway externo
  error_detalle   TEXT          NULL,             -- Solo cuando estado = FALLIDO
  intentos        INT           NOT NULL DEFAULT 1,
  correlation_id  VARCHAR(36)   NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at         TIMESTAMP     NULL,             -- Cuándo se envió (si ENVIADO)

  PRIMARY KEY (id),
  UNIQUE KEY uk_evento (id_evento),              -- Idempotencia: mismo evento = un solo registro
  INDEX idx_paciente (id_paciente),
  INDEX idx_estado   (estado),
  INDEX idx_created  (created_at)
);

CREATE TABLE IF NOT EXISTS outbox (
  id              VARCHAR(36)   NOT NULL,
  evento          VARCHAR(60)   NOT NULL,         -- SMSEnviado | SMSFallido
  payload         JSON          NOT NULL,
  correlation_id  VARCHAR(36)   NULL,
  publicado       TINYINT(1)    NOT NULL DEFAULT 0,
  intentos        INT           NOT NULL DEFAULT 0,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
);

-- Permisos
GRANT ALL PRIVILEGES ON svc_not.* TO 'medicitas_app'@'%';
FLUSH PRIVILEGES;
