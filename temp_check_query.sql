SELECT id, fecha_hora, NOW(), DATE_ADD(NOW(), INTERVAL 30 MINUTE) FROM svc_cit.citas 
WHERE estado = 'Pendiente' AND recordatorio_30m = 0 
AND fecha_hora > NOW() AND fecha_hora <= DATE_ADD(NOW(), INTERVAL 30 MINUTE);
