#!/usr/bin/env bash
# FLUJO CLÍNICO COMPLETO end-to-end — la "traza reina" para la demo:
#
#   paciente → expediente → cobertura(aseguradora) → cita HOY → ingreso →
#   pago → [eventos] comprobante+PDF + SMS → encuentro clínico + prescripción →
#   [evento] PrescripcionEmitida → despacho → farmacia-api (o contingencia) →
#   auditoría de TODO por correlationId
#
# Cubre los flujos que la carga masiva no puede (encuentro exige cita HOY y
# En_Atencion). Si el médico no tiene agenda a esta hora, el script define un
# horario de semana específica para HOY (00:00-23:30) y sigue — así la demo
# funciona a CUALQUIER hora. (Solo datos de dev; la semana se puede redefinir.)
#
# Uso:  bash flujo-clinico.sh          (con el stack arriba)
set -uo pipefail
BASE="${BASE_URL_HOST:-http://localhost}"

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const v=($1);process.stdout.write(v==null?'':String(v))}catch(e){process.stdout.write('')}})"; }
paso() { echo ""; echo "── $* ──"; }

paso "1) Login (Auditor)"
LOGIN=$(curl -s -X POST "$BASE/api/v2/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}')
TOKEN=$(echo "$LOGIN" | j "o.accessToken")
[ -z "$TOKEN" ] && { echo "login falló: $LOGIN"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
echo "ok"

paso "2) Elegir médico con agenda"
HOY=$(date +%F)
MEDS=$(curl -s "$BASE/api/v2/medicos" "${AUTH[@]}")
MEDINFO=$(echo "$MEDS" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const l=JSON.parse(d).data||[];
  // preferir el que tenga plantilla lun-vie (Julio/Neurologo si existe)
  const m=l.find(x=>/neur/i.test(x.especialidad||''))||l[0];
  process.stdout.write((m.id_medico||m.id)+'|'+(m.especialidad||'Medicina General'));
});")
MEDID="${MEDINFO%|*}"; ESP="${MEDINFO#*|}"
echo "médico: $MEDID ($ESP)"

paso "3) Crear paciente"
DNI=$(( 10000000 + RANDOM * 3 ))
PAC=$(curl -s -X POST "$BASE/api/v2/pacientes" "${AUTH[@]}" -H "Idempotency-Key: fc-$(date +%s%N)" \
  -d "{\"nombre\":\"Flujo\",\"apellido\":\"Completo\",\"tipo_documento\":\"DNI\",\"numero_documento\":\"$DNI\",\"fecha_nacimiento\":\"1988-03-20\",\"sexo\":\"F\",\"telefono\":\"999888777\",\"email\":\"flujo$DNI@test.pe\",\"direccion\":\"Av. Demo 456\"}")
PID=$(echo "$PAC" | j "o.data.id_paciente||o.data.id")
CORR_PAC=$(echo "$PAC" | j "o.correlationId")
[ -z "$PID" ] && { echo "paciente falló: $PAC"; exit 1; }
echo "paciente: $PID (correlationId $CORR_PAC)"

paso "4) Crear expediente clínico"
EXP=$(curl -s -X POST "$BASE/api/v2/historias-clinicas/expedientes" "${AUTH[@]}" -H "Idempotency-Key: fe-$(date +%s%N)" -d "{\"idPaciente\":\"$PID\"}")
echo "expediente: $(echo "$EXP" | j "o.data.id")"

paso "5) Validar cobertura (cruza a aseguradora-api / fallback)"
COB=$(curl -s -X POST "$BASE/api/v2/coberturas/validar" "${AUTH[@]}" -H "Idempotency-Key: fs-$(date +%s%N)" \
  -d "{\"idPaciente\":\"$PID\",\"id_paciente\":\"$PID\",\"idAseguradora\":\"ASEG-PROSALUD\",\"id_aseguradora\":\"ASEG-PROSALUD\",\"numeroPoliza\":\"12345678\",\"numero_poliza\":\"12345678\",\"tipoConsulta\":\"CONSULTA_GENERAL\",\"tipo_consulta\":\"CONSULTA_GENERAL\"}")
echo "cobertura: $(echo "$COB" | j "o.estadoCobertura||o.estado_cobertura") ($(echo "$COB" | j "o.porcentajeCobertura||o.porcentaje_cobertura")%)"

paso "6) Asegurar slot libre HOY ($HOY)"
elegir_slot() {
  curl -s "$BASE/api/v2/medicos/$MEDID/slots?fecha=$HOY" "${AUTH[@]}" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const r=JSON.parse(d).data||{};
  const ahora=new Date(Date.now()-25*60000); // FechaHoraCita tolera 30min atrás
  const s=(r.slots||[]).find(x=>x.estado==='libre'&&new Date(x.fechaHora)>ahora);
  process.stdout.write(s?s.fechaHora:'');
});"
}
SLOT=$(elegir_slot)
if [ -z "$SLOT" ]; then
  echo "sin slot HOY a esta hora — definiendo horario de semana específica (00:00-23:30 todos los días)..."
  DIAS='{"dias":[{"dia_semana":0,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":1,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":2,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":3,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":4,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":5,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30},{"dia_semana":6,"hora_inicio":"00:00","hora_fin":"23:59","duracion_cita_min":30}]}'
  PUTRES=$(curl -s -X PUT "$BASE/api/v2/medicos/$MEDID/horarios/semanas/$HOY" "${AUTH[@]}" -d "$DIAS")
  # la caché de disponibilidad puede tardar 1-3s en reflejar la agenda nueva
  for i in 1 2 3; do sleep 3; SLOT=$(elegir_slot); [ -n "$SLOT" ] && break; done
  [ -z "$SLOT" ] && { echo "no se pudo abrir agenda hoy: $PUTRES"; exit 1; }
fi
echo "slot elegido: $SLOT"

paso "7) Reservar cita HOY"
CITA=$(curl -s -X POST "$BASE/api/v2/citas" "${AUTH[@]}" -H "Idempotency-Key: fci-$(date +%s%N)" \
  -d "{\"idPaciente\":\"$PID\",\"idMedico\":\"$MEDID\",\"especialidad\":\"$ESP\",\"fechaHora\":\"$SLOT\"}")
CITID=$(echo "$CITA" | j "o.idCita||o.data&&o.data.id")
CORR_CITA=$(echo "$CITA" | j "o.correlationId")
[ -z "$CITID" ] && { echo "cita falló: $CITA"; exit 1; }
echo "cita: $CITID (correlationId $CORR_CITA)"

paso "8) Registrar INGRESO (cita → En_Atencion; solo válido el día de la cita)"
ING=$(curl -s -X POST "$BASE/api/v2/citas/$CITID/ingreso" "${AUTH[@]}" -H "Idempotency-Key: fin-$(date +%s%N)" -d '{}')
echo "ingreso: $(echo "$ING" | j "o.estado||o.data&&o.data.estado||JSON.stringify(o).slice(0,80)")"

paso "9) PAGO (dispara comprobante+PDF y SMS por eventos)"
PAGO=$(curl -s -X POST "$BASE/api/v2/pagos" "${AUTH[@]}" -H "Idempotency-Key: fpa-$(date +%s%N)" \
  -d "{\"idCita\":\"$CITID\",\"idPaciente\":\"$PID\",\"metodoPago\":\"EFECTIVO\",\"montoTotal\":120,\"montoCopago\":24,\"montoCubiertoSeguro\":96,\"tipoComprobante\":\"BOLETA\"}")
CORR_PAGO=$(echo "$PAGO" | j "o.correlationId")
echo "pago: $(echo "$PAGO" | j "o.idPago") $(echo "$PAGO" | j "o.estado") (correlationId $CORR_PAGO)"

paso "10) ENCUENTRO CLÍNICO con prescripción (dispara PrescripcionEmitida → farmacia)"
ENC=$(curl -s -X POST "$BASE/api/v2/historias-clinicas/$PID/encuentros" "${AUTH[@]}" -H "Idempotency-Key: fen-$(date +%s%N)" \
  -d "{\"idCita\":\"$CITID\",\"diagnosticoCie10\":\"J10\",\"descripcion\":\"Influenza estacional — flujo E2E de demo\",\"prescripciones\":[{\"medicamento\":\"Paracetamol 500mg\",\"dosis\":\"1 tableta c/8h\",\"cantidad\":12,\"frecuencia\":\"cada 8 horas\",\"duracion\":\"4 dias\"}]}")
CORR_ENC=$(echo "$ENC" | j "o.correlationId")
echo "encuentro: $(echo "$ENC" | j "o.idEncuentro||o.data&&o.data.idEncuentro||JSON.stringify(o).slice(0,100)") (correlationId $CORR_ENC)"

paso "11) Esperando el pipeline async (outbox→RabbitMQ→consumers→farmacia)..."
sleep 14

paso "12) Verificación del despacho en farmacia"
DESP=$(curl -s "$BASE/api/v2/prescripciones?limit=5" "${AUTH[@]}" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const l=JSON.parse(d).data||[];
  const m=l.find(x=>x.id_paciente==='$PID');
  process.stdout.write(m?(m.id+' estado='+m.estado):'(aún no aparece — dale unos segundos y consulta GET /prescripciones)');
});")
echo "despacho: $DESP"

paso "13) Auditoría del flujo (por correlationId del pago)"
curl -s "$BASE/api/v2/auditoria/correlacion/$CORR_PAGO" "${AUTH[@]}" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d); const t=Array.isArray(j)?j:(j.data||[]);
  console.log('eventos auditados con ese correlationId:',t.length);
  t.slice(0,8).forEach(x=>console.log('  •',x.tipo_evento||x.tipoEvento,'←',x.servicio_origen||x.servicioOrigen));
});"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " FLUJO COMPLETO EJECUTADO. Dónde verlo:"
echo "  • Jaeger  http://localhost:16686 → service medicitas-backend"
echo "      - operation POST /api/v2/pagos        (cascada pago→factura→SMS→aud)"
echo "      - operation POST /api/v2/historias-clinicas/:idPaciente/encuentros"
echo "        (cascada encuentro→prescripción→farmacia)"
echo "      - o Tags: correlationId=$CORR_PAGO"
echo "  • Loki (Grafana→Explore): {app=\"medicitas-backend\"} | json | correlationId=\`$CORR_PAGO\`"
echo "  • Grafana http://localhost:3001 → contadores de negocio subiendo"
echo "══════════════════════════════════════════════════════════════"
