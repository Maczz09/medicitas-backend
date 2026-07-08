-- ============================================================
-- MEDICITAS — Inicialización Idempotente de Base de Datos
-- ============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ─────────────────────────────────────────────────────────────
-- ESQUEMA GLOBAL: Usuarios
-- ─────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS medicitas_users CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE medicitas_users;

CREATE TABLE IF NOT EXISTS roles (
  id_rol        INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(50) NOT NULL UNIQUE,
  descripcion   VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roles (id_rol, nombre, descripcion) VALUES
  (1, 'Recepcionista', 'Gestión de citas, pacientes y cobros'),
  (2, 'Médico', 'Atención clínica y prescripciones'),
  (3, 'Auditor', 'Revisión de trazas y reportes');

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario    VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_rol        INT           NOT NULL,
  nombre        VARCHAR(100)  NOT NULL,
  apellido      VARCHAR(100)  NOT NULL,
  email         VARCHAR(255)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_email (email),
  KEY idx_rol   (id_rol),
  CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol) REFERENCES roles(id_rol) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO usuarios (id_usuario, id_rol, nombre, apellido, email, password_hash) VALUES
  ('usr-rec-001', 1, 'Ana', 'García', 'recepcion@medicitas.pe', '$2b$12$w5H/0SA6BwsSQSqtuQHK4O/e89jQYx4g.5kmUj6fpJdja5n7kPOMe'),
  ('usr-med-001', 2, 'Dr. Luis', 'Torres', 'medico@medicitas.pe', '$2b$12$w5H/0SA6BwsSQSqtuQHK4O/e89jQYx4g.5kmUj6fpJdja5n7kPOMe'),
  ('usr-aud-001', 3, 'Carlos', 'Mendoza', 'auditor@medicitas.pe', '$2b$12$w5H/0SA6BwsSQSqtuQHK4O/e89jQYx4g.5kmUj6fpJdja5n7kPOMe');

CREATE TABLE IF NOT EXISTS user_security (
  id_usuario    VARCHAR(36)   NOT NULL,
  failed_attempts INT         NOT NULL DEFAULT 0,
  locked_until  DATETIME      NULL,
  otp_code      VARCHAR(10)   NULL,
  otp_expires_at DATETIME     NULL,
  refresh_token VARCHAR(255)  NULL,
  refresh_expires_at DATETIME NULL,
  PRIMARY KEY (id_usuario),
  CONSTRAINT fk_user_security FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO user_security (id_usuario) VALUES
  ('usr-rec-001'),
  ('usr-med-001'),
  ('usr-aud-001');

-- Auth de servicio (client-credentials, v2.1.0): farmacia-api/aseguradora-api
-- piden un token vía POST /api/v2/auth/service-token en vez de usar una API
-- key estática eterna. Ver EmitirTokenServicioUseCase (auth.usecases.js) y
-- verifyWebhookApiKey.middleware.js (acepta ambos métodos en paralelo).
CREATE TABLE IF NOT EXISTS service_clients (
  id                 VARCHAR(36)  NOT NULL DEFAULT (UUID()),
  client_id          VARCHAR(100) NOT NULL,
  client_secret_hash VARCHAR(255) NOT NULL,
  servicio_nombre    VARCHAR(100) NOT NULL,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_client_id (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sesiones_auditoria (
  id_sesion     VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_usuario    VARCHAR(36)   NOT NULL,
  ip_origen     VARCHAR(45)   NOT NULL,
  user_agent    VARCHAR(500),
  iniciada_en   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_en    TIMESTAMP     NULL,
  PRIMARY KEY (id_sesion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS peticiones_idempotentes (
  idempotency_key VARCHAR(100) NOT NULL,
  metodo          VARCHAR(10) NOT NULL,
  ruta            VARCHAR(255) NOT NULL,
  response_body   JSON,
  status_code     INT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ═══════════════════════════════════════════════════════════
-- SVC-CIT-001 — citas_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_cit CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_cit;

CREATE TABLE IF NOT EXISTS citas (
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

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento     VARCHAR(36)   NOT NULL,
  tipo_evento   VARCHAR(100)  NOT NULL,
  consumidor    VARCHAR(100)  NOT NULL,
  procesado_en  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cache_disponibilidad_medicos (
  id_medico     VARCHAR(36)   NOT NULL,
  disponibilidad JSON         NOT NULL,
  sincronizado_en TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_medico)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-HCL-002 — clinical_record_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_hcl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_hcl;

CREATE TABLE IF NOT EXISTS expedientes (
  id_expediente VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_paciente   VARCHAR(36)   NOT NULL UNIQUE,
  grupo_sanguineo VARCHAR(5),
  alergias_conocidas JSON,
  antecedentes   JSON,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_expediente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS encuentros_clinicos (
  id_encuentro  VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_expediente VARCHAR(36)   NOT NULL,
  id_medico     VARCHAR(36)   NOT NULL,
  id_cita       VARCHAR(36),
  fecha_hora    DATETIME      NOT NULL,
  diagnostico_cie10 VARCHAR(20),
  diagnostico_descripcion TEXT,
  notas_evolucion TEXT,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_encuentro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescripciones_clinicas (
  id_prescripcion VARCHAR(36) NOT NULL DEFAULT (UUID()),
  id_encuentro  VARCHAR(36)   NOT NULL,
  id_paciente   VARCHAR(36)   NOT NULL,
  medicamento   VARCHAR(200)  NOT NULL,
  dosis         VARCHAR(100)  NOT NULL,
  frecuencia    VARCHAR(100)  NOT NULL,
  duracion      VARCHAR(100),
  indicaciones  TEXT,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_prescripcion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbox (
  id_evento     VARCHAR(36)   NOT NULL,
  tipo_evento   VARCHAR(100)  NOT NULL,
  payload       JSON          NOT NULL,
  estado        ENUM('PENDIENTE', 'PUBLICADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  intentos      INT           NOT NULL DEFAULT 0,
  correlation_id VARCHAR(36)  NOT NULL,
  creado_en     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publicado_en  TIMESTAMP     NULL,
  error_msg     TEXT,
  PRIMARY KEY (id_evento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento     VARCHAR(36)   NOT NULL,
  consumidor    VARCHAR(100)  NOT NULL,
  procesado_en  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-SEG-003 — insurance_adapter_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_seg CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_seg;

-- Columnas y nombre de PK alineados a la BD viva (drift histórico: este script
-- se había quedado desactualizado respecto a ALTERs aplicados manualmente en
-- sesiones anteriores — CoberturasMySQLRepository.js ya usa `id`, `es_fallback`
-- y `correlation_id`, y nunca usó `respuesta_raw` ni `id_validacion`).
CREATE TABLE IF NOT EXISTS validaciones_cobertura (
  id              VARCHAR(36) NOT NULL DEFAULT (UUID()),
  id_paciente     VARCHAR(36) NOT NULL,
  id_aseguradora  VARCHAR(50) NOT NULL,
  numero_poliza   VARCHAR(50) NOT NULL,
  tipo_consulta   VARCHAR(50) NOT NULL,
  estado_cobertura ENUM('APROBADA', 'RECHAZADA', 'PENDIENTE') NOT NULL,
  porcentaje_cobertura DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  codigo_autorizacion  VARCHAR(50),
  vigencia        DATE,
  es_fallback     TINYINT(1) NOT NULL DEFAULT 0,
  correlation_id  VARCHAR(36),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_paciente_poliza (id_paciente, numero_poliza),
  INDEX idx_aseguradora (id_aseguradora),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ═══════════════════════════════════════════════════════════
-- SVC-PAG-004 — billing_payment_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_pag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_pag;

CREATE TABLE IF NOT EXISTS pagos (
  id_pago           VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_cita           VARCHAR(36)   NOT NULL,
  id_paciente       VARCHAR(36)   NOT NULL,
  codigo_autorizacion VARCHAR(100),
  metodo_pago       ENUM('EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'SEGURO') NOT NULL,
  monto_total       DECIMAL(10,2) NOT NULL,
  monto_cobertura   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  monto_copago      DECIMAL(10,2) NOT NULL,
  estado            ENUM('PROCESADO', 'PENDIENTE', 'REVERSADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  tipo_comprobante  ENUM('BOLETA', 'FACTURA') NOT NULL DEFAULT 'BOLETA',
  numero_comprobante VARCHAR(20),
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_pago)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento    VARCHAR(36)  NOT NULL,
  consumidor   VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-PAC-005 — patients_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_pac CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_pac;

CREATE TABLE IF NOT EXISTS pacientes (
  id_paciente   VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  nombre        VARCHAR(100)  NOT NULL,
  apellido      VARCHAR(100)  NOT NULL,
  tipo_documento ENUM('DNI', 'CE', 'PASAPORTE') NOT NULL,
  numero_documento VARCHAR(20) NOT NULL,
  fecha_nacimiento DATE        NOT NULL,
  sexo          ENUM('M', 'F', 'Otro') NOT NULL,
  telefono      VARCHAR(20)   NOT NULL,
  email         VARCHAR(255),
  direccion     VARCHAR(500),
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_paciente),
  UNIQUE KEY uq_documento (tipo_documento, numero_documento),
  INDEX idx_busqueda (nombre, apellido, numero_documento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ═══════════════════════════════════════════════════════════
-- SVC-MED-006 — doctors_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_med CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_med;

CREATE TABLE IF NOT EXISTS medicos (
  id_medico     VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  nombre        VARCHAR(100)  NOT NULL,
  apellido      VARCHAR(100)  NOT NULL,
  cmp           VARCHAR(20)   NOT NULL,
  especialidad  VARCHAR(100)  NOT NULL,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_medico),
  UNIQUE KEY uq_cmp (cmp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS horarios_base (
  id_horario    VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_medico     VARCHAR(36)   NOT NULL,
  dia_semana    TINYINT       NOT NULL COMMENT '0=Dom, 1=Lun, ..., 6=Sab',
  hora_inicio   TIME          NOT NULL,
  hora_fin      TIME          NOT NULL,
  duracion_cita_min INT       NOT NULL DEFAULT 30,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (id_horario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bloqueos_agenda (
  id_bloqueo    VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_medico     VARCHAR(36)   NOT NULL,
  fecha_inicio  DATETIME      NOT NULL,
  fecha_fin     DATETIME      NOT NULL,
  motivo        VARCHAR(200),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_bloqueo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- ═══════════════════════════════════════════════════════════
-- SVC-HOR-008 — horarios_service (agenda: plantilla + semana específica)
-- Ver plan en db/migrations/004_add_horarios_module.sql — reemplaza
-- svc_med.horarios_base/bloqueos_agenda, que se mantienen intactas hasta
-- que la migración a este módulo se verifique end-to-end.
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_hor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_hor;

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

-- Si existe una fila aquí para (id_medico, semana_inicio), esa semana es
-- completa y explícita: un día sin fila en horarios_semana_dias está
-- inactivo ese día, no cae a la plantilla día por día.
CREATE TABLE IF NOT EXISTS horarios_semana (
  id_semana      VARCHAR(45) NOT NULL DEFAULT (UUID()),
  id_medico      VARCHAR(36) NOT NULL,
  semana_inicio  DATE        NOT NULL COMMENT 'Lunes (fecha local Lima) de la semana',
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

-- Convención A (id/evento/publicado) — igual que citas/prescripciones/seguros,
-- no la convención B que usa svc_med.outbox. workers/outbox.worker.js
-- auto-detecta cuál convención usa cada schema vía INFORMATION_SCHEMA.
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

-- ═══════════════════════════════════════════════════════════
-- SVC-NOT-007 — notification_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_not CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_not;

-- NOTA: `estado` corregido para incluir PENDIENTE_VINCULACION (ver
-- MensajeSMS.js/EstadoSMS) — faltaba en este archivo y el INSERT de
-- MensajesSMSMySQLRepository.save() fallaba en vivo (ER_...truncated) cada
-- vez que WhatsApp estaba desvinculado. Se agrega también id_paciente, que
-- el repositorio ya escribe pero no estaba declarada aquí.
CREATE TABLE IF NOT EXISTS mensajes_sms (
  id_mensaje    VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_evento_origen VARCHAR(36) NOT NULL,
  tipo_evento   VARCHAR(100)  NOT NULL,
  id_paciente   VARCHAR(36)   DEFAULT NULL,
  telefono_destino VARCHAR(20) NOT NULL,
  contenido     TEXT          NOT NULL,
  estado        ENUM('PENDIENTE', 'ENVIADO', 'FALLIDO', 'PENDIENTE_VINCULACION') NOT NULL DEFAULT 'PENDIENTE',
  referencia_gateway VARCHAR(100) DEFAULT NULL,
  intentos      INT           NOT NULL DEFAULT 0,
  error_msg     TEXT,
  correlation_id VARCHAR(36)  NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_en    TIMESTAMP     NULL,
  PRIMARY KEY (id_mensaje),
  UNIQUE KEY uq_evento (id_evento_origen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento    VARCHAR(36)  NOT NULL,
  consumidor   VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-AUD-008 — audit_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_aud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_aud;

CREATE TABLE IF NOT EXISTS trazas_auditoria (
  id_traza          VARCHAR(36)   NOT NULL DEFAULT (UUID()),
  id_evento         VARCHAR(36)   NOT NULL,
  tipo_evento       VARCHAR(100)  NOT NULL,
  servicio_origen   VARCHAR(100)  NOT NULL,
  correlation_id    VARCHAR(36)   NULL,
  payload           JSON          NOT NULL,
  timestamp_origen  DATETIME(3)   NULL COMMENT 'Momento real del evento (extraído del sobre RabbitMQ)',
  registrado_en     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_id          VARCHAR(36)   NULL,
  actor_nombre      VARCHAR(150)  NULL,
  actor_rol         VARCHAR(50)   NULL,
  PRIMARY KEY (id_traza),
  UNIQUE KEY uq_evento (id_evento),
  KEY idx_correlation (correlation_id),
  KEY idx_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento    VARCHAR(36)  NOT NULL,
  consumidor   VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-PRE-009 — prescriptions_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_pre CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_pre;

-- NOTA: el nombre real en producción es `despachos` (no `despachos_receta`) y las
-- columnas difieren de una versión anterior de este archivo — corregido para que
-- coincida exactamente con la tabla viva (ver DespachosMySQLRepository.js).
CREATE TABLE IF NOT EXISTS despachos (
  id                      VARCHAR(20)  NOT NULL,
  id_evento_origen        VARCHAR(36)  NOT NULL,
  id_prescripcion_clinica VARCHAR(36)  NOT NULL,
  id_encuentro_clinico    VARCHAR(36)  NOT NULL,
  id_paciente             VARCHAR(36)  NOT NULL,
  id_farmacia             VARCHAR(36)  NOT NULL,
  estado                  ENUM('CREADA','ENVIADA_A_FARMACIA','DESPACHADA','RECHAZADA','RECHAZADA_POR_STOCK','RECHAZADA_POR_VALIDACION','RETIRADA') NOT NULL DEFAULT 'CREADA',
  contenido               JSON         DEFAULT NULL,
  fecha_emision           DATETIME     NOT NULL,
  fecha_despacho          DATETIME     DEFAULT NULL,
  fecha_retiro            DATETIME     DEFAULT NULL,
  referencia_farmacia     VARCHAR(100) DEFAULT NULL,
  observacion_farmacia    TEXT,
  motivo_rechazo          VARCHAR(255) DEFAULT NULL,
  intentos_envio          INT          NOT NULL DEFAULT 0,
  correlation_id          VARCHAR(36)  DEFAULT NULL,
  created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_evento_origen (id_evento_origen),
  KEY idx_estado (estado),
  KEY idx_paciente (id_paciente),
  KEY idx_prescripcion (id_prescripcion_clinica)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contingencia de farmacia (v2.1.0): receta en PDF generada cuando el circuit
-- breaker hacia farmacia-api está abierto — ver GenerarRecetaContingenciaUseCase.
-- A pesar del nombre, cubre CUALQUIER receta generada en PDF — no solo
-- contingencia (farmacia caída), también el despacho exitoso normal (ver
-- GenerarRecetaPDFUseCase). es_contingencia distingue cuál de los dos casos
-- generó el registro; el nombre de la tabla se conserva para no romper el
-- historial de migraciones aplicadas contra la BD viva.
CREATE TABLE IF NOT EXISTS recetas_contingencia (
  id              VARCHAR(36)  NOT NULL,
  id_despacho     VARCHAR(20)  NOT NULL,
  id_paciente     VARCHAR(36)  NOT NULL,
  medicamento     VARCHAR(200),
  dosis           VARCHAR(100),
  cantidad        VARCHAR(50),
  es_contingencia TINYINT(1)   NOT NULL DEFAULT 1,
  ruta_pdf        VARCHAR(500) NOT NULL,
  url_descarga    VARCHAR(500) NOT NULL,
  correlation_id  VARCHAR(36),
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_despacho (id_despacho)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTA: esta tabla usa la convención A (id/evento/publicado) — a diferencia de
-- otros esquemas outbox en este archivo, que usan la convención B
-- (id_evento/tipo_evento/estado). Ver workers/outbox.worker.js, que detecta en
-- tiempo de ejecución cuál convención usa cada esquema. Corregido para igualar
-- la tabla viva (antes definía columnas que OutboxEventPublisher.js de
-- prescripciones nunca llegó a escribir).
CREATE TABLE IF NOT EXISTS outbox (
  id             VARCHAR(36) NOT NULL,
  evento         VARCHAR(60) NOT NULL,
  payload        JSON        NOT NULL,
  correlation_id VARCHAR(36) DEFAULT NULL,
  publicado      TINYINT(1)  NOT NULL DEFAULT 0,
  intentos       INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_publicado (publicado, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos_procesados (
  id_evento    VARCHAR(36)  NOT NULL,
  consumidor   VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, consumidor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════
-- SVC-HCL-002 — clinical_record_service
-- ═══════════════════════════════════════════════════════════
CREATE DATABASE IF NOT EXISTS svc_hcl CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE svc_hcl;

CREATE TABLE IF NOT EXISTS expedientes (
  id              VARCHAR(36)   NOT NULL,
  id_paciente     VARCHAR(36)   NOT NULL,
  grupo_sanguineo VARCHAR(5)    NULL,
  alergias        JSON          NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_paciente (id_paciente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS encuentros_clinicos (
  id              VARCHAR(36)   NOT NULL,
  id_expediente   VARCHAR(36)   NOT NULL,
  id_cita         VARCHAR(36)   NOT NULL,
  id_medico       VARCHAR(36)   NOT NULL,
  diagnostico_cie10 VARCHAR(10) NOT NULL,
  descripcion     TEXT          NULL,
  fecha_encuentro TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (id_expediente) REFERENCES expedientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescripciones_clinicas (
  id_prescripcion VARCHAR(36)   NOT NULL DEFAULT (uuid()),
  id_encuentro    VARCHAR(36)   NOT NULL,
  id_paciente     VARCHAR(36)   NOT NULL,
  medicamento     VARCHAR(200)  NOT NULL,
  dosis           VARCHAR(100)  NOT NULL,
  frecuencia      VARCHAR(100)  NOT NULL,
  duracion        VARCHAR(100)  NULL,
  cantidad        INT           NOT NULL DEFAULT 1,
  indicaciones    TEXT          NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_prescripcion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbox (
  id            VARCHAR(36)  NOT NULL,
  evento        VARCHAR(100) NOT NULL,
  payload       JSON         NOT NULL,
  correlation_id VARCHAR(36) NULL,
  estado        ENUM('PENDIENTE', 'PUBLICADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
  creado_en     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────
-- Permisos
-- ─────────────────────────────────────────────────────────
GRANT ALL PRIVILEGES ON medicitas_users.* TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_cit.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_hcl.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_seg.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_pag.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_pac.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_med.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_hor.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_not.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_aud.*         TO 'medicitas_app'@'%';
GRANT ALL PRIVILEGES ON svc_pre.*         TO 'medicitas_app'@'%';
FLUSH PRIVILEGES;
INSERT INTO svc_fac.series_comprobante (tipo, ultimo) VALUES ('BOLETA', 0), ('FACTURA', 0) ON DUPLICATE KEY UPDATE ultimo=ultimo;