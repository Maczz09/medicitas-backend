-- Migración 007: rastrear si el nombre del paciente en el comprobante se
-- obtuvo realmente desde Pacientes, o si el comprobante se emitió "a ciegas"
-- (nombre_paciente = NULL) porque Pacientes (Facturacion→Pacientes,
-- PacienteHttpAdapter.js) estaba inalcanzable en ese momento.
--
-- Antes: GenerarComprobanteUseCase.js atrapaba CUALQUIER error al pedir el
-- nombre (línea 74-79) y seguía con nombrePaciente=null, sin distinguir "el
-- paciente no existe" (404, resultado de negocio válido) de "Pacientes no
-- responde" (transitorio, reconciliable). El comprobante quedaba EMITIDO con
-- nombre en blanco PARA SIEMPRE: estaEmitido() es true con nombre null, así
-- que la idempotencia (esReintento, línea 40) solo dispara con estaEnError()
-- — nunca con un nombre faltante. No había ningún job que lo corrigiera.
--
-- nombre_verificado: TRUE por defecto — cubre el camino feliz (Pacientes
-- respondió) y el 404 limpio (paciente no existe, no hay nada que
-- reconciliar). Solo pasa a FALSE cuando Pacientes estaba inalcanzable
-- durante la generación del comprobante.
ALTER TABLE svc_fac.comprobantes
  ADD COLUMN nombre_verificado TINYINT(1) NOT NULL DEFAULT 1 AFTER nombre_paciente,
  ADD INDEX idx_nombre_pendiente (nombre_verificado, created_at);
