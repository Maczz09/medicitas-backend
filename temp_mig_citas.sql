USE svc_cit;
DROP TABLE IF EXISTS citas;
DROP TABLE IF EXISTS outbox;

CREATE TABLE citas (
  id              VARCHAR(20)  NOT NULL,
  id_paciente     VARCHAR(36)  NOT NULL,
  id_medico       VARCHAR(36)  NOT NULL,
  fecha_hora      DATETIME     NOT NULL,
  especialidad    VARCHAR(100) NOT NULL,
  estado          ENUM(
                    'Pendiente',
                    'En_Atencion',
                    'Completada',
                    'Cancelada',
                    'No_Asistida'
                  ) NOT NULL DEFAULT 'Pendiente',
  correlation_id  VARCHAR(36)  NULL,
  alerta_min0     TINYINT(1)   NOT NULL DEFAULT 0,
  alerta_min5     TINYINT(1)   NOT NULL DEFAULT 0,
  alerta_min10    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_estado_fecha   (estado, fecha_hora),
  INDEX idx_medico_fecha   (id_medico, fecha_hora),
  INDEX idx_paciente       (id_paciente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE outbox (
  id              VARCHAR(36)  NOT NULL,
  evento          VARCHAR(60)  NOT NULL,
  payload         JSON         NOT NULL,
  correlation_id  VARCHAR(36)  NULL,
  publicado       TINYINT(1)   NOT NULL DEFAULT 0,
  intentos        INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_publicado (publicado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
