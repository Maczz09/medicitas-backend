# Plan de prueba Chaos Monkey — MediCitas

Experimento de ingeniería del caos: inyectar fallos ALEATORIOS en el sistema
mientras está bajo carga, y demostrar con evidencia (métricas, trazas, logs)
que degrada con gracia y se recupera solo. Herramienta:
`loadtest/chaos-monkey.ps1` / `.sh`.

## 1) Hipótesis de estado estable

Con carga sostenida (`.\run.ps1 full`) y TODO sano, el sistema mantiene:
- `errores_5xx` ≈ 0% en k6 y `http_request_errors_total` plano en Grafana.
- Latencia p95 < 2 s.
- Los contadores de negocio (citas, pagos, comprobantes, SMS) crecen de forma
  constante (Prometheus `:9091`, agregado del cluster).
- Cascadas end-to-end visibles en Jaeger (pago → factura → SMS → auditoría).

**La hipótesis a demostrar:** al matar UNA pieza al azar, solo su módulo
degrada (503 limpio o fallback), el RESTO sigue cumpliendo lo de arriba, y al
recuperar la pieza el sistema vuelve solo al estado estable (sin reiniciar
nada a mano).

## 2) Inyección de fallos (qué rompe el mono)

| Nivel | Objetivos | Mecanismo | Qué debe pasar |
|---|---|---|---|
| `modulos` | los 9 módulos de negocio | kill-switch (PATCH admin) | el módulo responde **503** al instante; el resto 200; al recuperar, 200 otra vez |
| `infra` | redis | `kill 1` interno | caché de disponibilidad degrada a BD; kill-switch pasa a memoria local; NADA se cae |
| `infra` | rabbitmq | `kill 1` interno | la API SIGUE (los eventos se acumulan en `outbox` con estado PENDIENTE); al volver, el worker los drena y los consumers procesan el backlog |
| `infra` | workers | `kill 1` interno | los eventos se acumulan en outbox; al volver se drenan (mismo outbox pattern) |
| `infra` | farmacia | `kill 1` interno | circuit breaker ABRE → recetas de CONTINGENCIA (PDF + WhatsApp); al volver, CB cierra y el recovery replay reenvía los despachos pendientes |
| `infra` | aseguradora | `kill 1` interno | validación de cobertura usa el FALLBACK (seguros-fallback-service, cache de pólizas) |
| `infra` | seguros-fallback | `kill 1` interno | cobertura degrada a rechazo controlado (respuesta 4xx/200-RECHAZADA, nunca 500) |

### Por qué `docker exec <c> kill 1` y NO `docker stop`/`docker kill`

Todos los contenedores objetivo tienen `restart: unless-stopped`, y esa política
solo actúa cuando el contenedor muere **por su cuenta**. Tanto `docker stop`
como `docker kill` son una detención **explícita del operador**: Docker respeta
esa decisión y **no** lo reinicia. Verificado en vivo — tras un `docker kill`,
`RestartCount` se queda en 0 y el contenedor permanece `exited`.

Con ese método, quien revivía el servicio era el `docker start` del propio
script: el experimento demostraba que *el script* sabe levantar contenedores, no
que *el sistema* se auto-recupera. Matando el PID 1 desde dentro, el contenedor
muere solo, Docker aplica la política y lo revive sin intervención — verificado:
`RestartCount` pasa de 0 a 1 y vuelve a `running`. Por eso el log registra el
`RestartCount` antes/después: es la evidencia dura de que se recuperó **solo**.

**El mono NUNCA toca:** `mysql` (sin BD no hay sistema que observar), `nginx`
(perderías el acceso), ni la observabilidad (`jaeger/loki/prometheus/grafana`
— sin ella no hay evidencia del experimento). `autoheal` cubre un caso distinto
y complementario: revive contenedores que quedan **unhealthy** (vivos pero sin
responder al healthcheck), no los que mueren — esos los cubre la restart policy.

## 3) Procedimiento (3 terminales)

```powershell
# T1 — carga sostenida que toca TODOS los módulos:
cd loadtest; $env:TOTAL=30000; $env:VUS=30; .\run.ps1 full

# T2 — el mono suelto (5 min solo módulos; 10 min con infra):
cd loadtest; .\chaos-monkey.ps1                       # nivel seguro
cd loadtest; .\chaos-monkey.ps1 -Duracion 10 -Nivel infra

# T3 — observar en vivo:
#   Grafana  http://localhost:3001   (RPS, errores, latencia, negocio)
#   Jaeger   http://localhost:16686  (trazas con y sin 503)
#   Prometheus http://localhost:9090 (targets, outbox pendientes)
```

Todo lo que hace el mono queda en `loadtest/chaos-log.txt` con timestamp —
se cruza 1:1 con los dips de Grafana y las trazas de Jaeger.

## 4) Métricas a observar durante el caos

- `sum(rate(http_requests_total[1m]))` — el RPS global NO debe irse a 0.
- `sum(rate(http_request_errors_total[1m])) by (route)` — los errores deben
  concentrarse SOLO en el módulo caído, y solo mientras está caído.
- `medicitas_outbox_pending_messages` — sube al matar rabbitmq/workers y
  vuelve a 0 al recuperarlos (drenado del outbox).
- `medicitas_circuit_breaker_state` — pasa a ABIERTO al matar farmacia y
  cierra solo al volver.
- `medicitas_dlq_size` — no debe crecer sin límite (los reintentos tienen tope).
- En k6: `errores_5xx` total del experimento < 5% (los 503 del módulo caído
  NO cuentan como 5xx de sistema: son degradación controlada; k6 los registra
  aparte).

## 5) Criterios de éxito (lo que se le muestra al profe)

1. **Aislamiento:** con `citas` caído, `pacientes/medicos/pagos/...` siguen 200
   (captura de Grafana con el dip solo en una ruta).
2. **Sin pérdida de eventos:** los eventos generados con RabbitMQ caído
   aparecen procesados después (auditoría/SMS con timestamps posteriores a la
   recuperación; `outbox` queda PUBLICADO, no FALLIDO).
3. **Recuperación automática:** cero reinicios manuales; el chaos-log muestra
   RECUPERA y las métricas vuelven solas al estado estable en <60 s.
4. **Trazabilidad del incidente:** para cualquier ventana del chaos-log puedes
   abrir Jaeger y ver las trazas 503 del módulo caído, y en Loki los logs
   estructurados con el `correlationId` de cada request afectada.

## 6) Qué anotar si algo NO cumple

Anota la línea del chaos-log (timestamp + objetivo), el síntoma (qué métrica /
traza lo delata) y clasifícalo: ¿falta un circuit breaker? ¿un timeout muy
largo? ¿un consumer sin reintento? Eso es exactamente el output valioso de un
experimento de caos — cada hallazgo va a `docs/MEJORAS.md`.

## 7) Resultados de la 1ª corrida (2026-07-13)

Ejecutado: nivel `modulos` 3 min bajo carga (~260 req/s, 18 VUs) + prueba
controlada de infra (RabbitMQ).

**Criterios CUMPLIDOS:**
- ✅ **Aislamiento**: el mono tumbó seguros→pacientes→medicos→citas (uno a la
  vez); durante cada ventana solo ESE módulo daba 503, el resto 200. 4151×503
  concentrados en las rutas de los módulos caídos.
- ✅ **Recuperación automática**: cero reinicios manuales; al terminar, 9/9
  módulos arriba y readiness READY.
- ✅ **Sin pérdida de eventos (RabbitMQ)**: con RabbitMQ caído, POST /pacientes
  siguió devolviendo 201 (patrón outbox: escribe a MySQL, no a Rabbit) y los
  eventos se acumularon como PENDIENTE; al recuperar Rabbit, el worker los
  drenó (contador bajando monótonamente). Ningún evento perdido.
- ✅ **Trazabilidad**: cada 503/flujo quedó en Jaeger (trazas muestreadas) y en
  Loki por correlationId.

**HALLAZGO que el caos EXPUSO (y se corrigió el mismo día):**
- 🐞 **Acoplamiento síncrono seguros→pacientes sin degradación grácil.** Al
  bajar `pacientes`, `POST /coberturas/validar` llamaba internamente a la API
  de Pacientes (`ValidarCoberturaUseCase` línea 40, `existePaciente`), fallaba
  y lanzaba **500** genérico (294 casos durante la ventana). Un 500 parece un
  crash, no una caída controlada. **Fix**: distinguir "paciente no existe"
  (404) de "servicio de pacientes inalcanzable" → ahora **503
  DEPENDENCIA_NO_DISPONIBLE** (reintentable). Verificado: con pacientes caído
  /validar da 503; con pacientes arriba, 200.

**OBSERVACIONES (tuning, no bugs):**
- El worker de outbox drena a ritmo fijo (`LIMIT 50` por ciclo de 5 s ≈ 600
  eventos/min por esquema). Bajo escritura MUY pesada sostenida (las pruebas de
  40k con 70% escrituras) el backlog crece; drena solo cuando baja la carga. Si
  la carga real se acerca a ese techo, subir el batch o bajar el intervalo.
- `POST /pacientes` sin `telefono` da 500 (`Column 'telefono' cannot be null`)
  en vez de 400: el schema Zod lo marca opcional pero la columna es NOT NULL.
  Mismatch schema↔BD (candidato a MEJORAS, no crítico).
