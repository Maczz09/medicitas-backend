-- Migración 006: rastrear si la cobertura declarada en un pago fue realmente
-- verificada contra Seguros, o si el pago se confirmó "a ciegas" porque
-- SVC-SEG-003 estaba caído en ese momento.
--
-- Hasta ahora ConfirmarPagoUseCase.js, si no podía contactar a Coberturas,
-- solo logueaba un warning y seguía adelante como si nada — sin ningún rastro
-- persistido de que ese pago quedó sin verificar. No había nada que un
-- recovery-replay pudiera encontrar y corregir después (a diferencia de
-- Seguros, que sí persiste es_fallback=1 en su propia tabla).
--
-- id_validacion_cobertura: hasta ahora el dominio (Pago.js) recibía este dato
-- pero el repositorio lo descartaba antes de insertar (comentario explícito
-- en PagosMySQLRepository.js: "la tabla no tiene id_validacion_cobertura").
-- Sin persistirlo, una reconciliación futura no tendría CONTRA QUÉ registro
-- de Seguros volver a preguntar.
--
-- cobertura_verificada: TRUE por defecto — cubre tanto "no declaró cobertura"
-- (nada que verificar) como "se verificó con éxito en el momento". Solo pasa
-- a FALSE en el caso nuevo: cobertura declarada + Seguros inalcanzable. Un
-- 404 limpio (el id no existe) NO cambia este campo — no es un caso de
-- "temporalmente no disponible", reintentarlo después no cambiaría nada.

ALTER TABLE svc_pag.pagos
  ADD COLUMN id_validacion_cobertura VARCHAR(64) NULL AFTER codigo_autorizacion,
  ADD COLUMN cobertura_verificada TINYINT(1) NOT NULL DEFAULT 1 AFTER monto_cobertura,
  ADD INDEX idx_cobertura_pendiente (cobertura_verificada, created_at);
