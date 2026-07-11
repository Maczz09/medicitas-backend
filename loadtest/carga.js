// Prueba de carga paramétrica para MediCitas — mix que toca todos los módulos.
//
// Interpretación (acordada): los "niveles" son PETICIONES TOTALES, no
// concurrentes. Se usa el executor `shared-iterations`: VUS de concurrencia
// procesan TOTAL iteraciones y la prueba termina al completarlas.
//
// Parámetros por variable de entorno (k6 -e CLAVE=valor):
//   BASE_URL      URL base            (default http://backend:3000 = app directo)
//   TOTAL         peticiones totales  (Nivel1=1000  Nivel2=500000  Nivel3=1000000)
//   VUS           usuarios concurrentes (default 100)
//   WRITE_RATIO   fracción de escrituras 0..1 (default 0.10)
//   MAX_DURATION  tope de tiempo (default 30m)
//
// Ejemplos: ver loadtest/run.sh / run.ps1.

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://backend:3000';
const TOTAL = parseInt(__ENV.TOTAL || '1000');
const VUS = parseInt(__ENV.VUS || '100');
const WRITE_RATIO = parseFloat(__ENV.WRITE_RATIO || '0.10');

// Solo contamos como ERROR real los 5xx y las caídas de conexión (status 0).
// Un 404/409/422 es una respuesta válida del app (no un fallo del sistema).
const errores5xx = new Rate('errores_5xx');
const latenciaLectura = new Trend('latencia_lectura_ms', true);

export const options = {
  scenarios: {
    carga: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: TOTAL,
      maxDuration: __ENV.MAX_DURATION || '30m',
    },
  },
  thresholds: {
    errores_5xx: ['rate<0.01'],            // <1% de 5xx/caídas
    http_req_duration: ['p(95)<1500'],     // p95 < 1.5s (ajustable)
  },
};

function jsonHeaders(token, extra) {
  return { headers: Object.assign({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, extra || {}) };
}

// Login una vez y descubre IDs reales para los endpoints que los necesitan.
export function setup() {
  const res = http.post(`${BASE}/api/v2/auth/login`,
    JSON.stringify({ email: 'recepcion@medicitas.pe', password: 'Medicitas2026!' }),
    { headers: { 'Content-Type': 'application/json' } });

  const token = res.json('accessToken');
  if (!token) throw new Error(`Login falló (status ${res.status}): ${res.body}`);

  const h = jsonHeaders(token);
  let medicoId = null, pacienteId = null;
  const meds = http.get(`${BASE}/api/v2/medicos`, h);
  try { medicoId = meds.json('data.0.id_medico'); } catch (e) { /* ignore */ }
  const pacs = http.get(`${BASE}/api/v2/pacientes?pagina=1&porPagina=1`, h);
  try { pacienteId = pacs.json('data.0.id_paciente') || pacs.json('data.0.id'); } catch (e) { /* ignore */ }

  return { token, medicoId, pacienteId };
}

function unico() {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

export default function (data) {
  const h = jsonHeaders(data.token);
  const r = Math.random();
  let res;

  if (r < WRITE_RATIO) {
    // ── Escritura: crear paciente (ejercita validación + INSERT + evento outbox)
    const dni = String(Math.floor(10000000 + Math.random() * 89999999));
    const body = JSON.stringify({
      nombre: 'Carga', apellido: `Test${dni.slice(-4)}`,
      tipo_documento: 'DNI', numero_documento: dni,
      fecha_nacimiento: '1990-05-15', sexo: 'M',
      telefono: '999888777', email: `carga${dni}@test.pe`,
      direccion: 'Av. Prueba 123',
    });
    res = http.post(`${BASE}/api/v2/pacientes`, body, jsonHeaders(data.token, { 'Idempotency-Key': unico() }));
  } else if (r < 0.35) {
    res = http.get(`${BASE}/api/v2/pacientes?pagina=1&porPagina=20`, h);
    latenciaLectura.add(res.timings.duration);
  } else if (r < 0.55) {
    res = http.get(`${BASE}/api/v2/medicos`, h);
    latenciaLectura.add(res.timings.duration);
  } else if (r < 0.70) {
    res = http.get(`${BASE}/api/v2/citas`, h);
    latenciaLectura.add(res.timings.duration);
  } else if (r < 0.85 && data.medicoId) {
    const fecha = '2026-08-03'; // un lunes; slots de una semana futura
    res = http.get(`${BASE}/api/v2/medicos/${data.medicoId}/slots?fecha=${fecha}`, h);
    latenciaLectura.add(res.timings.duration);
  } else if (data.pacienteId) {
    res = http.get(`${BASE}/api/v2/historias-clinicas/${data.pacienteId}/resumen`, h);
    latenciaLectura.add(res.timings.duration);
  } else {
    res = http.get(`${BASE}/api/v2/medicos`, h);
    latenciaLectura.add(res.timings.duration);
  }

  errores5xx.add(res.status >= 500 || res.status === 0);
  check(res, { 'status < 500': (x) => x.status > 0 && x.status < 500 });
}
