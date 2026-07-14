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
| `infra` | redis | docker stop | caché de disponibilidad degrada a BD; kill-switch pasa a memoria local; NADA se cae |
| `infra` | rabbitmq | docker stop | la API SIGUE (los eventos se acumulan en `outbox` con estado PENDIENTE); al volver, el worker los drena y los consumers procesan el backlog |
| `infra` | workers | docker stop | los eventos se acumulan en outbox; al volver se drenan (mismo outbox pattern) |
| `infra` | farmacia | docker stop | circuit breaker ABRE → recetas de CONTINGENCIA (PDF + WhatsApp); al volver, CB cierra y el recovery replay reenvía los despachos pendientes |
| `infra` | aseguradora | docker stop | validación de cobertura usa el FALLBACK (seguros-fallback-service, cache de pólizas) |
| `infra` | seguros-fallback | docker stop | cobertura degrada a rechazo controlado (respuesta 4xx/200-RECHAZADA, nunca 500) |

**El mono NUNCA toca:** `mysql` (sin BD no hay sistema que observar), `nginx`
(perderías el acceso), ni la observabilidad (`jaeger/loki/prometheus/grafana`
— sin ella no hay evidencia del experimento). `autoheal` además puede revivir
contenedores unhealthy por su cuenta: eso también es parte de la demo.

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
