// Prueba de RESILIENCIA: carga sostenida mientras se "da de baja" un servicio.
//
// Corre carga constante durante DURATION golpeando dos rutas:
//   - CONTROL  (un módulo que NO se toca): debe seguir 100% arriba.
//   - OBJETIVO (el módulo que vas a bajar): se espera que degrade a 503.
// Mientras corre, en otra terminal bajas el objetivo, por ejemplo:
//   # Módulo de negocio (kill-switch, requiere token de Auditor):
//   curl -X PATCH http://localhost/api/v2/admin/servicios/citas \
//        -H "Authorization: Bearer <token-auditor>" -H "Content-Type: application/json" \
//        -d '{"habilitado": false}'
//   # ...o una dependencia de infra:
//   docker stop medicitas_rabbitmq     # la API sigue; eventos se acumulan en outbox
//
// El resumen de k6 separa por tag {kind}: 'control' debe quedar verde aunque
// 'objetivo' falle — esa es la demostración de resiliencia.
//
// Parámetros (k6 -e CLAVE=valor):
//   BASE_URL, RATE (req/s, default 100), DURATION (default 2m),
//   CONTROL_PATH  (default /api/v2/medicos)
//   TARGET_PATH   (default /api/v2/citas)

import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://backend:3000';
const RATE = parseInt(__ENV.RATE || '100');
const DURATION = __ENV.DURATION || '2m';
const CONTROL_PATH = __ENV.CONTROL_PATH || '/api/v2/medicos';
const TARGET_PATH = __ENV.TARGET_PATH || '/api/v2/citas';

const errores5xx = new Rate('errores_5xx');
const rechazos503 = new Rate('rechazos_503');

export const options = {
  scenarios: {
    resiliencia: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(50, RATE),
      maxVUs: Math.max(200, RATE * 4),
    },
  },
  thresholds: {
    // El CONTROL debe mantenerse sano aunque el objetivo esté caído.
    'errores_5xx{kind:control}': ['rate<0.01'],
    'http_req_duration{kind:control}': ['p(95)<1500'],
  },
};

let token = null;
export function setup() {
  const res = http.post(`${BASE}/api/v2/auth/login`,
    JSON.stringify({ email: 'recepcion@medicitas.pe', password: 'Medicitas2026!' }),
    { headers: { 'Content-Type': 'application/json' } });
  const t = res.json('accessToken');
  if (!t) throw new Error(`Login falló (status ${res.status})`);
  return { token: t };
}

export default function (data) {
  const h = { headers: { Authorization: `Bearer ${data.token}` } };

  const ctrl = http.get(`${BASE}${CONTROL_PATH}`, Object.assign({ tags: { kind: 'control' } }, h));
  errores5xx.add(ctrl.status >= 500 || ctrl.status === 0, { kind: 'control' });
  check(ctrl, { 'control arriba (<500)': (r) => r.status > 0 && r.status < 500 });

  const tgt = http.get(`${BASE}${TARGET_PATH}`, Object.assign({ tags: { kind: 'target' } }, h));
  errores5xx.add(tgt.status >= 500 || tgt.status === 0, { kind: 'target' });
  rechazos503.add(tgt.status === 503, { kind: 'target' });
}
