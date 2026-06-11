CREATE DATABASE IF NOT EXISTS svc_fac;
USE svc_fac;

-- ── Comprobantes emitidos ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comprobantes (
  id                    VARCHAR(50)   NOT NULL,        -- FAC-XXXXX
  id_pago               VARCHAR(50)   NOT NULL,        -- UNIQUE: 1 comprobante por pago
  id_paciente           VARCHAR(50)   NOT NULL,
  id_cita               VARCHAR(50)   NOT NULL,
  tipo                  ENUM('BOLETA','FACTURA') NOT NULL DEFAULT 'BOLETA',
  numero                VARCHAR(50)   NOT NULL,        -- B001-00000001 / F001-00000001
  monto_total           DECIMAL(10,2) NOT NULL,
  monto_cubierto_seguro DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  monto_copago          DECIMAL(10,2) NOT NULL,
  metodo_pago           VARCHAR(20)   NOT NULL,        -- EFECTIVO | POS
  tiene_cobertura       TINYINT(1)    NOT NULL DEFAULT 0,
  estado                ENUM('PENDIENTE','EMITIDO','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  ruta_pdf              VARCHAR(500)  NULL,            -- /app/storage/comprobantes/B001-00000001.pdf
  url_descarga          VARCHAR(500)  NULL,            -- URL pública para SMS y descarga
  nombre_paciente       VARCHAR(200)  NULL,            -- Obtenido de SVC-PAC-005 (puede ser null)
  error_mensaje         TEXT          NULL,            -- Solo cuando estado = ERROR
  intentos_generacion   INT           NOT NULL DEFAULT 0,
  correlation_id        VARCHAR(36)   NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_pago   (id_pago),     -- Idempotencia: no puede haber dos comprobantes por pago
  UNIQUE KEY uk_numero (numero),      -- Números de comprobante únicos en todo el sistema
  INDEX idx_paciente  (id_paciente),
  INDEX idx_estado    (estado),
  INDEX idx_created   (created_at)
);

-- ── Control de numeración correlativa ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS series_comprobante (
  tipo   VARCHAR(20) NOT NULL,        -- 'BOLETA' | 'FACTURA'
  ultimo INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (tipo)
);

INSERT IGNORE INTO series_comprobante (tipo, ultimo) VALUES ('BOLETA', 0), ('FACTURA', 0);

-- ── Outbox ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox (
  id             VARCHAR(36)  NOT NULL,
  evento         VARCHAR(60)  NOT NULL,      -- ComprobanteEmitido
  payload        JSON         NOT NULL,
  correlation_id VARCHAR(36)  NULL,
  publicado      TINYINT(1)   NOT NULL DEFAULT 0,
  intentos       INT          NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
);
