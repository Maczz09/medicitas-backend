CREATE DATABASE IF NOT EXISTS svc_seg;
USE svc_seg;

DROP TABLE IF EXISTS validaciones_cobertura;
DROP TABLE IF EXISTS outbox;

CREATE TABLE validaciones_cobertura (
  id                    VARCHAR(20)   NOT NULL,       -- COB-XXXXX
  id_paciente           VARCHAR(20)   NOT NULL,
  id_aseguradora        VARCHAR(20)   NOT NULL,
  numero_poliza         VARCHAR(50)   NOT NULL,
  tipo_consulta         VARCHAR(50)   NOT NULL,
  estado_cobertura      ENUM('APROBADA','RECHAZADA','PENDIENTE') NOT NULL,
  porcentaje_cobertura  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  codigo_autorizacion   VARCHAR(50)   NULL,           -- Usado por SVC-PAG-004
  vigencia              DATE          NULL,
  es_fallback           TINYINT(1)    NOT NULL DEFAULT 0, -- 1 = resultado del Circuit Breaker
  correlation_id        VARCHAR(36)   NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- SVC-PAG-004 busca por paciente + póliza para reutilizar resultados recientes
  INDEX idx_paciente_poliza   (id_paciente, numero_poliza),
  -- Búsqueda por aseguradora para reportes
  INDEX idx_aseguradora       (id_aseguradora),
  -- Índice de tiempo para expirar validaciones antiguas
  INDEX idx_created           (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox (
  id              VARCHAR(36)   NOT NULL,
  evento          VARCHAR(60)   NOT NULL,
  payload         JSON          NOT NULL,
  correlation_id  VARCHAR(36)   NULL,
  publicado       TINYINT(1)    NOT NULL DEFAULT 0,
  intentos        INT           NOT NULL DEFAULT 0,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
