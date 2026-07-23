-- Migración 009: rastrea si la transición de la cita a 'Completada'
-- (best-effort post-commit en RegistrarConsultaUseCase.js) se confirmó
-- realmente contra Citas, o si el encuentro clínico se guardó igual porque
-- Citas (HistoriaClinica→Citas, CitaHttpAdapter.js) estaba caída en ese
-- momento.
--
-- Antes: RegistrarConsultaUseCase.js llamaba a completarCita(dto.idCita) de
-- forma "fire and forget" (sin await) y el .catch() solo hacía
-- console.warn(...) — sin persistir nada. Si Citas estaba caída, la cita se
-- quedaba en 'En_Atencion' para siempre; no había ningún job ni cola que la
-- reconciliara cuando Citas se recuperara.
--
-- cita_completada_verificada: TRUE por defecto — cubre el camino feliz
-- (Citas confirmó la transición en el momento). Solo pasa a FALSE cuando
-- completarCita() falla por dependencia caída durante el post-commit. Un 409
-- de Citas (transición inválida — ver Cita.js: completar() exige
-- En_Atencion) NO baja este flag: se resuelve de inmediato como
-- "inconsistente" (evento CitaCompletadaInconsistente), no queda pendiente
-- de replay — Citas ya protege su propia máquina de estados, así que un
-- reintento tardío nunca puede forzar una transición inválida.
ALTER TABLE svc_hcl.encuentros_clinicos
  ADD COLUMN cita_completada_verificada TINYINT(1) NOT NULL DEFAULT 1 AFTER id_cita,
  ADD INDEX idx_cita_completar_pendiente (cita_completada_verificada, fecha_hora);
