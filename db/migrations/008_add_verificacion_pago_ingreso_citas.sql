-- Migración 008: rastrear si el pago fue realmente verificado antes de
-- registrar el ingreso de un paciente, o si el ingreso se permitió "a ciegas"
-- porque Pagos (Citas→Pagos, PagoHttpAdapter.js) estaba inalcanzable en ese
-- momento.
--
-- Antes: RegistrarIngresoUseCase.js, si no podía contactar a Pagos, atrapaba
-- la excepción (línea 27-34 original) pero el resultado (`pago` quedaba en
-- null) se trataba igual que "la cita no tiene pago registrado" -> bloqueaba
-- el ingreso con 409 CITA_NO_PAGADA, contradiciendo el propio comentario del
-- código ("la atención clínica no debe depender de la disponibilidad de
-- Pagos"). No había ningún registro persistido de qué ingresos se
-- permitieron sin poder verificar el pago — solo el log de warn, que un
-- recovery-replay no puede consultar.
--
-- pago_verificado: TRUE por defecto — cubre "no se exige pago para ingreso"
-- (REQUERIR_PAGO_PARA_INGRESO=false, el chequeo ni se ejecuta) y "Pagos
-- respondió y el pago está APROBADO". Solo pasa a FALSE en el caso nuevo:
-- Pagos inalcanzable durante el chequeo de RegistrarIngresoUseCase. Un 404
-- limpio (no existe pago) o un pago REVERSADO NO cambian este campo — ya
-- bloquean el ingreso con un 409 (hechos de negocio definitivos, nada que
-- reconciliar); solo la indisponibilidad de la dependencia amerita reintento.
ALTER TABLE svc_cit.citas
  ADD COLUMN pago_verificado TINYINT(1) NOT NULL DEFAULT 1 AFTER estado,
  ADD INDEX idx_pago_ingreso_pendiente (pago_verificado, created_at);
