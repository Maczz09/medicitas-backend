ALTER TABLE svc_cit.citas 
ADD COLUMN recordatorio_30m TINYINT(1) NOT NULL DEFAULT 0 AFTER correlation_id;
