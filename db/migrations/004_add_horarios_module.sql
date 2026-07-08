-- Migración 004: nuevo módulo horarios (agenda por semana específica + plantilla de respaldo)
-- Ver plan en C:\Users\maxmo\.claude\plans\misty-sauteeing-kettle.md — Fase 1.
-- Crea svc_hor y copia los datos vivos de svc_med.horarios_base/bloqueos_agenda.
-- Las tablas viejas en svc_med NO se borran aquí — se dejan como red de seguridad
-- hasta que la Fase 5 del plan confirme que todo el tráfico ya pasa por svc_hor.
-- Ejecutar una sola vez:
--   docker exec -i medicitas_mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" < db/migrations/004_add_horarios_module.sql

CREATE DATABASE IF NOT EXISTS svc_hor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_hor;

-- Plantilla de respaldo: misma forma que la vieja svc_med.horarios_base — un
-- patrón recurrente por día de semana, usado como semilla de una semana nueva
-- y como fallback de cualquier semana que nadie configuró explícitamente.
CREATE TABLE IF NOT EXISTS plantillas_horario (
  id_plantilla      VARCHAR(45)  NOT NULL DEFAULT (UUID()),
  id_medico         VARCHAR(36)  NOT NULL,
  dia_semana        TINYINT      NOT NULL COMMENT '0=Dom, 1=Lun, ..., 6=Sab',
  hora_inicio       TIME         NOT NULL,
  hora_fin          TIME         NOT NULL,
  duracion_cita_min INT          NOT NULL DEFAULT 30,
  activo            TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id_plantilla),
  INDEX idx_medico_dia (id_medico, dia_semana)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Semana específica: si existe una fila aquí para (id_medico, semana_inicio),
-- esa semana es completa y explícita — un día de esa semana sin fila en
-- horarios_semana_dias está inactivo ese día, NO cae a la plantilla día por
-- día (ver Fase 2 del plan para el porqué de esta regla).
CREATE TABLE IF NOT EXISTS horarios_semana (
  id_semana      VARCHAR(45) NOT NULL DEFAULT (UUID()),
  id_medico      VARCHAR(36) NOT NULL,
  semana_inicio  DATE        NOT NULL COMMENT 'Lunes (fecha local Lima) de la semana que representa',
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_semana),
  UNIQUE KEY uq_medico_semana (id_medico, semana_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS horarios_semana_dias (
  id_dia            VARCHAR(45) NOT NULL DEFAULT (UUID()),
  id_semana         VARCHAR(45) NOT NULL,
  dia_semana        TINYINT     NOT NULL COMMENT '0=Dom, 1=Lun, ..., 6=Sab',
  hora_inicio       TIME        NOT NULL,
  hora_fin          TIME        NOT NULL,
  duracion_cita_min INT         NOT NULL DEFAULT 30,
  activo            TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id_dia),
  UNIQUE KEY uq_semana_dia (id_semana, dia_semana),
  CONSTRAINT fk_horarios_semana_dias_semana FOREIGN KEY (id_semana)
    REFERENCES horarios_semana(id_semana) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Misma forma que la vieja svc_med.bloqueos_agenda, solo relocada.
CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  id_bloqueo    VARCHAR(45)  NOT NULL DEFAULT (UUID()),
  id_medico     VARCHAR(36)  NOT NULL,
  fecha_inicio  DATETIME     NOT NULL,
  fecha_fin     DATETIME     NOT NULL,
  motivo        VARCHAR(200) DEFAULT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_bloqueo),
  INDEX idx_medico_fecha (id_medico, fecha_inicio, fecha_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbox convención A (id/evento/publicado) — igual que citas/prescripciones/
-- seguros, no la convención B que usa svc_med.outbox hoy. workers/outbox.worker.js
-- ya auto-detecta cuál convención usa cada schema vía INFORMATION_SCHEMA.
CREATE TABLE IF NOT EXISTS outbox (
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

-- Migración de datos existentes (una sola vez, idempotente por id ya que los
-- ids se preservan del origen — reejecutar esta migración no duplica filas
-- porque id_plantilla/id_bloqueo son PK y el INSERT fallaría en un duplicado,
-- no silenciosamente los duplicaría).
INSERT IGNORE INTO plantillas_horario
  (id_plantilla, id_medico, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo)
SELECT id_horario, id_medico, dia_semana, hora_inicio, hora_fin, duracion_cita_min, activo
FROM svc_med.horarios_base;

INSERT IGNORE INTO bloqueos_agenda
  (id_bloqueo, id_medico, fecha_inicio, fecha_fin, motivo, created_at)
SELECT id_bloqueo, id_medico, fecha_inicio, fecha_fin, motivo, created_at
FROM svc_med.bloqueos_agenda;

GRANT ALL PRIVILEGES ON svc_hor.* TO 'medicitas_app'@'%';
FLUSH PRIVILEGES;
