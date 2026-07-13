// Prueba de carga de COBERTURA TOTAL — toca TODOS los módulos y endpoints.
//
// A diferencia de carga.js (mix mayormente de lecturas para medir throughput),
// este script está pensado para OBSERVABILIDAD: que en Jaeger/Grafana/Loki
// aparezcan trazas, métricas y logs de los 12 servicios del sistema, no solo
// de citas y médicos. Cada request va TAGGEADA por módulo, así k6 y Grafana
// desglosan por servicio.
//
// Dos modos (env MODE):
//   MODE=sweep  → cada iteración toca UN endpoint de CADA módulo en secuencia.
//                 Garantiza trazas de los 12 servicios en cada vuelta. Ideal
//                 para la demo de observabilidad (pocas VUs, sampling alto).
//   MODE=mix    → (default) mezcla ponderada aleatoria. Ideal para throughput.
//
// La cascada de ESCRITURA (WRITE_RATIO) encadena:
//   paciente → validar cobertura → cita → pago
// y el pago dispara por eventos: comprobante+PDF (facturación) + notificación,
// así que UNA escritura genera una traza que cruza pacientes, seguros, citas,
// pagos, facturación, notificaciones y auditoría — el flujo end-to-end completo.
//
// Parámetros (k6 -e CLAVE=valor):
//   BASE_URL     default http://backend:3000
//   TOTAL        peticiones totales (default 2000)
//   VUS          concurrencia (default 30)
//   WRITE_RATIO  fracción de cascadas de escritura 0..1 (default 0.15)
//   MODE         sweep | mix  (default mix)
//   POLIZA       nº de póliza para cobertura (default 12345678 → APROBADA 80%)

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// 400/404/409/422 son respuestas VÁLIDAS del app (validación, no-encontrado,
// idempotencia, conflicto de horario), no fallas del sistema. Solo 5xx/timeout
// cuentan como error real.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 400, 404, 409, 422));

const BASE = __ENV.BASE_URL || 'http://backend:3000';
const TOTAL = parseInt(__ENV.TOTAL || '2000');
const VUS = parseInt(__ENV.VUS || '30');
const WRITE_RATIO = parseFloat(__ENV.WRITE_RATIO || '0.15');
const MODE = (__ENV.MODE || 'mix').toLowerCase();
const POLIZA = __ENV.POLIZA || '12345678'; // aseguradora test: 12345678→APROBADA 80%
const TIMEOUT = __ENV.REQ_TIMEOUT || '20s';

const errores5xx = new Rate('errores_5xx');
const reqsModulo = new Counter('reqs_por_modulo');
const latModulo = new Trend('latencia_por_modulo_ms', true);
const cascadasOk = new Counter('cascadas_completas'); // paciente→cobertura→cita→pago

export const options = {
  scenarios: {
    cobertura: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: TOTAL,
      maxDuration: __ENV.MAX_DURATION || '45m',
    },
  },
  thresholds: {
    errores_5xx: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

function h(token, extra) {
  return {
    headers: Object.assign({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, extra || {}),
    timeout: TIMEOUT,
  };
}
function unico() { return `${Date.now()}${Math.floor(Math.random() * 1e6)}`; }

// Fecha-hora en un día HÁBIL futuro (lun-vie), slot de 30 min entre 08:00 y
// 12:30 — el rango que los médicos con agenda cubren. Se elige un día al azar
// dentro de las próximas ~12 semanas para dispersar y evitar colisiones (409).
function fechaHoraHabil() {
  const base = new Date();
  let dias = 3 + Math.floor(Math.random() * 80); // 3..82 días adelante
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dias);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);      // domingo → lunes
  if (dow === 6) d.setDate(d.getDate() + 2);      // sábado → lunes
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hora = 8 + Math.floor(Math.random() * 5); // 08..12
  const min = Math.random() < 0.5 ? '00' : '30';
  return `${yyyy}-${mm}-${dd}T${String(hora).padStart(2, '0')}:${min}:00`;
}

// Envuelve una petición: la taggea por módulo y registra métricas propias.
function pedir(modulo, fn) {
  const res = fn();
  const dur = res.timings.duration;
  reqsModulo.add(1, { modulo });
  latModulo.add(dur, { modulo });
  errores5xx.add(res.status >= 500 || res.status === 0, { modulo });
  check(res, { [`${modulo} < 500`]: (r) => r.status > 0 && r.status < 500 });
  return res;
}

// ── setup: login (Auditor cubre lectura+escritura de todos los módulos) y
// descubrimiento de IDs reales para los endpoints /:id ────────────────────────
export function setup() {
  const login = http.post(`${BASE}/api/v2/auth/login`,
    JSON.stringify({ email: 'auditor@medicitas.pe', password: 'Medicitas2026!' }),
    { headers: { 'Content-Type': 'application/json' } });
  const token = login.json('accessToken');
  if (!token) throw new Error(`Login falló (status ${login.status}): ${login.body}`);

  const hd = h(token);
  const data = { token };

  // Descubrir un médico CON horario real (no todos los sembrados tienen agenda).
  // Se prueba GET /slots en un lunes de referencia y se elige el primero que
  // devuelva tieneHorario:true — si no, la cascada de cita/pago nunca arranca.
  const meds = http.get(`${BASE}/api/v2/medicos`, hd);
  let lista = [];
  try { lista = meds.json('data') || []; } catch (e) { /* ignore */ }
  const LUNES_REF = '2026-08-03';
  for (const m of lista.slice(0, 15)) {
    const id = m.id_medico || m.id;
    if (!id) continue;
    const s = http.get(`${BASE}/api/v2/medicos/${id}/slots?fecha=${LUNES_REF}`, hd);
    let tiene = false;
    try { tiene = s.json('data.tieneHorario') === true; } catch (e) { /* ignore */ }
    if (tiene) { data.medicoId = id; data.especialidad = m.especialidad || 'Medicina General'; break; }
  }
  // Fallback: el primero de la lista (aunque no tenga agenda) para no quedar sin id.
  if (!data.medicoId && lista.length) {
    data.medicoId = lista[0].id_medico || lista[0].id;
    data.especialidad = lista[0].especialidad || 'Medicina General';
  }

  const pacs = http.get(`${BASE}/api/v2/pacientes?pagina=1&porPagina=1`, hd);
  try { data.pacienteId = pacs.json('data.0.id_paciente') || pacs.json('data.0.id'); } catch (e) { /* ignore */ }

  const citas = http.get(`${BASE}/api/v2/citas`, hd);
  try { data.citaId = citas.json('data.0.id'); } catch (e) { /* ignore */ }

  const pagos = http.get(`${BASE}/api/v2/pagos`, hd);
  try { data.pagoId = pagos.json('data.0.id') || pagos.json('data.0.id_pago'); } catch (e) { /* ignore */ }

  const presc = http.get(`${BASE}/api/v2/prescripciones`, hd);
  try { data.despachoId = presc.json('data.0.id'); } catch (e) { /* ignore */ }

  return data;
}

// ── Lecturas por módulo (cada una taggeada) ───────────────────────────────────
function leerPacientes(d) {
  pedir('pacientes', () => http.get(`${BASE}/api/v2/pacientes?pagina=1&porPagina=20`, h(d.token)));
  if (d.pacienteId) pedir('pacientes', () => http.get(`${BASE}/api/v2/pacientes/${d.pacienteId}`, h(d.token)));
}
function leerMedicos(d) {
  pedir('medicos', () => http.get(`${BASE}/api/v2/medicos`, h(d.token)));
  if (d.medicoId) {
    pedir('medicos', () => http.get(`${BASE}/api/v2/medicos/${d.medicoId}`, h(d.token)));
    pedir('medicos', () => http.get(`${BASE}/api/v2/medicos/${d.medicoId}/slots?fecha=2026-08-03`, h(d.token)));
    pedir('horarios', () => http.get(`${BASE}/api/v2/medicos/${d.medicoId}/disponibilidad?fecha=2026-08-03`, h(d.token)));
  }
}
function leerCitas(d) {
  pedir('citas', () => http.get(`${BASE}/api/v2/citas`, h(d.token)));
  if (d.citaId) pedir('citas', () => http.get(`${BASE}/api/v2/citas/${d.citaId}`, h(d.token)));
}
function leerSeguros(d) {
  pedir('seguros', () => http.get(`${BASE}/api/v2/coberturas`, h(d.token)));
}
function leerPagos(d) {
  pedir('pagos', () => http.get(`${BASE}/api/v2/pagos`, h(d.token)));
  if (d.citaId) pedir('pagos', () => http.get(`${BASE}/api/v2/pagos/cita/${d.citaId}`, h(d.token)));
}
function leerHistorias(d) {
  if (d.pacienteId) {
    pedir('historias-clinicas', () => http.get(`${BASE}/api/v2/historias-clinicas/${d.pacienteId}/resumen`, h(d.token)));
    pedir('historias-clinicas', () => http.get(`${BASE}/api/v2/historias-clinicas/${d.pacienteId}/encuentros`, h(d.token)));
  }
}
function leerPrescripciones(d) {
  pedir('prescripciones', () => http.get(`${BASE}/api/v2/prescripciones`, h(d.token)));
  pedir('prescripciones', () => http.get(`${BASE}/api/v2/prescripciones/contingencia`, h(d.token)));
}
function leerFacturacion(d) {
  if (d.pagoId) pedir('facturacion', () => http.get(`${BASE}/api/v2/facturacion/pago/${d.pagoId}/comprobante`, h(d.token)));
}
function leerAuditoria(d) {
  pedir('auditoria', () => http.get(`${BASE}/api/v2/auditoria/trazas?limit=10`, h(d.token)));
  pedir('auditoria', () => http.get(`${BASE}/api/v2/auditoria/health`, h(d.token)));
}
function leerNotificaciones(d) {
  pedir('notificaciones', () => http.get(`${BASE}/api/v2/notificaciones`, h(d.token)));
  if (d.pacienteId) pedir('notificaciones', () => http.get(`${BASE}/api/v2/notificaciones/sms/paciente/${d.pacienteId}`, h(d.token)));
}
function leerAdmin(d) {
  pedir('admin', () => http.get(`${BASE}/api/v2/admin/servicios`, h(d.token)));
}

const LECTURAS = [
  leerPacientes, leerMedicos, leerCitas, leerSeguros, leerPagos,
  leerHistorias, leerPrescripciones, leerFacturacion, leerAuditoria,
  leerNotificaciones, leerAdmin,
];

// ── Cascada de ESCRITURA: paciente → cobertura → cita → pago ───────────────────
// Genera una traza que cruza casi todos los servicios. Los pasos toleran
// 400/409/422 (respuestas válidas); si la cita se crea (201) se intenta el pago,
// que dispara comprobante+PDF+notificación por eventos.
function cascadaEscritura(d) {
  // 1) Crear paciente
  const dni = String(Math.floor(10000000 + Math.random() * 89999999));
  const pac = pedir('pacientes', () => http.post(`${BASE}/api/v2/pacientes`, JSON.stringify({
    nombre: 'Carga', apellido: `Full${dni.slice(-4)}`,
    tipo_documento: 'DNI', numero_documento: dni,
    fecha_nacimiento: '1990-05-15', sexo: 'M',
    telefono: '999888777', email: `full${dni}@test.pe`, direccion: 'Av. Prueba 123',
  }), h(d.token, { 'Idempotency-Key': unico() })));
  let idPaciente = null;
  try { idPaciente = pac.json('data.id_paciente') || pac.json('data.id'); } catch (e) { /* ignore */ }
  if (!idPaciente) idPaciente = d.pacienteId;

  // 2) Validar cobertura (cruza a aseguradora-api). Se mandan ambas convenciones
  //    de nombres (camelCase del schema + snake_case del use case) por seguridad.
  if (idPaciente) {
    pedir('seguros', () => http.post(`${BASE}/api/v2/coberturas/validar`, JSON.stringify({
      idPaciente, id_paciente: idPaciente,
      idAseguradora: 'ASEG-PROSALUD', id_aseguradora: 'ASEG-PROSALUD',
      numeroPoliza: POLIZA, numero_poliza: POLIZA,
      tipoConsulta: 'CONSULTA_GENERAL', tipo_consulta: 'CONSULTA_GENERAL',
    }), h(d.token, { 'Idempotency-Key': unico() })));
  }

  // 3) Crear cita en un día hábil futuro y slot dentro de 08:00-12:30 (rango que
  //    cubren los médicos con agenda). Se dispersa en ~12 semanas × 9 slots para
  //    que las colisiones (409, válidas) sean raras y haya citas que sí se crean.
  let idCita = null;
  if (idPaciente && d.medicoId) {
    const cita = pedir('citas', () => http.post(`${BASE}/api/v2/citas`, JSON.stringify({
      idPaciente, idMedico: d.medicoId,
      especialidad: d.especialidad || 'Medicina General',
      fechaHora: fechaHoraHabil(),
    }), h(d.token, { 'Idempotency-Key': unico() })));
    // POST /citas devuelve el id en `idCita` al nivel superior (no en data.id).
    try { idCita = cita.json('idCita') || cita.json('data.id'); } catch (e) { /* ignore */ }
  }

  // 4) Pagar la cita → dispara comprobante+PDF (facturación) + notificación
  if (idCita && idPaciente) {
    const pago = pedir('pagos', () => http.post(`${BASE}/api/v2/pagos`, JSON.stringify({
      idCita, idPaciente,
      metodoPago: 'EFECTIVO', montoTotal: 100, montoCopago: 20,
      montoCubiertoSeguro: 80, tipoComprobante: 'BOLETA',
    }), h(d.token, { 'Idempotency-Key': unico() })));
    if (pago.status === 201) cascadasOk.add(1);
  }
}

// ── Iteración ─────────────────────────────────────────────────────────────────
export default function (data) {
  if (MODE === 'sweep') {
    // Cada vuelta toca TODOS los módulos (garantiza trazas de los 12 servicios).
    for (const leer of LECTURAS) leer(data);
    if (Math.random() < WRITE_RATIO) cascadaEscritura(data);
    return;
  }

  // MODE=mix: ponderado. Escrituras según WRITE_RATIO; el resto, una lectura al azar.
  if (Math.random() < WRITE_RATIO) {
    cascadaEscritura(data);
  } else {
    const leer = LECTURAS[Math.floor(Math.random() * LECTURAS.length)];
    leer(data);
  }
}
