CREATE DATABASE IF NOT EXISTS svc_pag;
USE svc_pag;

DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS pagos;

CREATE TABLE pagos (
  id                         VARCHAR(20)   NOT NULL,        -- PAG-XXXXX
  id_cita                    VARCHAR(20)   NOT NULL,        -- 1 pago por cita máximo
  id_paciente                VARCHAR(20)   NOT NULL,
  id_validacion_cobertura    VARCHAR(20)   NULL,            -- COB-XXXXX, null si sin seguro
  codigo_autorizacion_seguro VARCHAR(50)   NULL,
  metodo_pago                ENUM('EFECTIVO','POS') NOT NULL,
  monto_total                DECIMAL(10,2) NOT NULL,
  monto_cubierto_seguro      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  monto_copago               DECIMAL(10,2) NOT NULL,
  tipo_comprobante           ENUM('BOLETA','FACTURA') NOT NULL DEFAULT 'BOLETA',
  estado                     ENUM('APROBADO','REVERSADO') NOT NULL DEFAULT 'APROBADO',
  observaciones              VARCHAR(500)  NULL,
  correlation_id             VARCHAR(36)   NULL,
  created_at                 TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_cita (id_cita),        -- Previene PAGO_DUPLICADO a nivel de BD
  INDEX idx_paciente  (id_paciente),
  INDEX idx_estado    (estado),
  INDEX idx_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox (
  id             VARCHAR(36)  NOT NULL,
  evento         VARCHAR(60)  NOT NULL,        -- PagoAprobado | PagoReversado
  payload        JSON         NOT NULL,
  correlation_id VARCHAR(36)  NULL,
  publicado      TINYINT(1)   NOT NULL DEFAULT 0,
  intentos       INT          NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
