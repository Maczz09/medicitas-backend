INSERT INTO svc_cit.citas (id, id_paciente, id_medico, fecha_hora, especialidad, estado, recordatorio_30m) 
VALUES ('TEST-30M', 'PAC-123', 'MED-123', DATE_ADD(NOW(), INTERVAL 30 MINUTE), 'Medicina General', 'Pendiente', 0);
