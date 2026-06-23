USE svc_pre;

DROP TABLE IF EXISTS eventos_procesados;
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS despachos_receta;
DROP TABLE IF EXISTS despachos;

CREATE TABLE despachos (
  id                      VARCHAR(20)  NOT NULL,        -- REC-XXXXX
  id_evento_origen        VARCHAR(36)  NOT NULL,        -- idEvento de PrescripcionEmitida — idempotencia
  id_prescripcion_clinica VARCHAR(36)  NOT NULL,        -- Referencia a svc_hcl (sin FK cross-schema)
  id_encuentro_clinico    VARCHAR(36)  NOT NULL,
  id_paciente             VARCHAR(36)  NOT NULL,
  id_farmacia             VARCHAR(36)  NOT NULL,         -- Resuelto internamente, ver sección 7
  estado                  ENUM('CREADA','ENVIADA_A_FARMACIA','DESPACHADA','RECHAZADA','RETIRADA')
                           NOT NULL DEFAULT 'CREADA',
  contenido               JSON         NULL,             -- Contenido clínico para reintentos
  fecha_emision           DATETIME     NOT NULL,
  fecha_despacho          DATETIME     NULL,
  fecha_retiro            DATETIME     NULL,
  referencia_farmacia     VARCHAR(100) NULL,             -- Referencia devuelta por el adaptador externo
  observacion_farmacia    TEXT         NULL,
  motivo_rechazo          VARCHAR(255) NULL,
  intentos_envio          INT          NOT NULL DEFAULT 0,
  correlation_id          VARCHAR(36)  NULL,
  created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_evento_origen (id_evento_origen),
  INDEX idx_estado (estado),
  INDEX idx_paciente (id_paciente),
  INDEX idx_prescripcion (id_prescripcion_clinica)
);

CREATE TABLE outbox (
  id              VARCHAR(36)  NOT NULL,
  evento          VARCHAR(60)  NOT NULL,             -- RecetaDespachada | RecetaRechazada | RecetaRetirada
  payload         JSON         NOT NULL,
  correlation_id  VARCHAR(36)  NULL,
  publicado       TINYINT(1)   NOT NULL DEFAULT 0,
  intentos        INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
);

CREATE TABLE eventos_procesados (
  id_evento    VARCHAR(36)  NOT NULL,
  consumidor   VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
);
