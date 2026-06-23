SELECT id, recordatorio_30m FROM svc_cit.citas WHERE id = 'TEST-30M';
SELECT * FROM svc_cit.outbox WHERE payload LIKE '%TEST-30M%';
