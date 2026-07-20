#!/usr/bin/env bash
# SEED de catálogo de médicos — responde a "¿tienes datos para la prueba?".
#
# Antes de este script, el sistema típicamente corre con 1 solo médico. Con
# eso, CUALQUIER prueba de carga que reserve citas (k6, flujo-clinico.sh)
# hace que todas las VUs peleen por el calendario de la MISMA persona: no es
# "muchos pacientes usando el sistema", es "todos contra un solo recurso" —
# infla artificialmente los 409 por colisión de horario y no representa una
# clínica real. Este script crea ~16 médicos con especialidades variadas y
# una agenda estándar (Lun-Vie, 08:00-18:00, turnos de 30min), vía los
# mismos endpoints que usaría un Auditor real — nada de INSERT directo a BD.
#
# Idempotente: cada médico usa un CMP fijo (CMP-SEED-XXX). Si ya existe, la
# API responde 409 (MedicoDuplicadoError) y el script lo reporta como
# "ya existía" sin fallar — correr esto varias veces no crea duplicados.
#
# El payload de cada médico se escribe a un archivo temporal y se envía con
# --data-binary @archivo (NO con -d '...' inline): en Windows, el curl.exe de
# MinGW/Git-Bash rompe los caracteres UTF-8 multibyte (tildes, ñ) al pasarlos
# como argumento de línea de comandos — los reemplaza por el carácter Unicode
# de reemplazo (U+FFFD). Verificado en vivo: el mismo texto escrito a un
# archivo con printf (bash conserva los bytes correctos) y leído por curl vía
# @archivo llega intacto. La ruta del archivo es el único argumento que pasa
# por curl, y esa es puro ASCII.
#
# Uso:  bash seed-medicos.sh          (con el stack arriba)
set -uo pipefail
BASE="${BASE_URL_HOST:-http://localhost}"
TMPDIR="${TMPDIR:-/tmp}"

j() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const v=($1);process.stdout.write(v==null?'':String(v))}catch(e){process.stdout.write('')}})"; }
paso() { echo ""; echo "── $* ──"; }

paso "1) Login (Auditor)"
LOGIN=$(curl -s -X POST "$BASE/api/v2/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"auditor@medicitas.pe","password":"Medicitas2026!"}')
TOKEN=$(echo "$LOGIN" | j "o.accessToken")
[ -z "$TOKEN" ] && { echo "login falló: $LOGIN"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
echo "ok"

# Nombre real ; Apellido ; Especialidad — variedad de una clínica típica.
MEDICOS=(
  "Carlos;Ramírez;Medicina General"
  "María;Gonzáles;Pediatría"
  "Jorge;Flores;Ginecología"
  "Lucía;Vargas;Cardiología"
  "Andrés;Quispe;Dermatología"
  "Patricia;Mendoza;Traumatología"
  "Miguel;Torres;Oftalmología"
  "Rosa;Chávez;Otorrinolaringología"
  "Fernando;Rojas;Endocrinología"
  "Claudia;Salazar;Psiquiatría"
  "Ricardo;Huamán;Urología"
  "Elena;Castillo;Neumología"
  "Javier;Paredes;Reumatología"
  "Silvia;Cruz;Nutrición"
  "Diego;Ríos;Odontología General"
  "Valeria;Núñez;Neurología"
)

paso "2) Crear médicos + agenda estándar (Lun-Vie 08:00-18:00, turnos 30min)"
DIAS_LUNVIE='[
  {"dia_semana":1,"hora_inicio":"08:00","hora_fin":"18:00","duracion_cita_min":30},
  {"dia_semana":2,"hora_inicio":"08:00","hora_fin":"18:00","duracion_cita_min":30},
  {"dia_semana":3,"hora_inicio":"08:00","hora_fin":"18:00","duracion_cita_min":30},
  {"dia_semana":4,"hora_inicio":"08:00","hora_fin":"18:00","duracion_cita_min":30},
  {"dia_semana":5,"hora_inicio":"08:00","hora_fin":"18:00","duracion_cita_min":30}
]'

creados=0
existentes=0
fallidos=0
i=0
payload_file="$TMPDIR/seed-medico-payload.json"

for entry in "${MEDICOS[@]}"; do
  i=$((i+1))
  IFS=';' read -r nombre apellido especialidad <<< "$entry"
  cmp=$(printf "CMP-SEED-%03d" "$i")

  printf '{"cmp":"%s","nombre":"%s","apellido":"%s","especialidad":"%s"}' \
    "$cmp" "$nombre" "$apellido" "$especialidad" > "$payload_file"

  RESP=$(curl -s -X POST "$BASE/api/v2/medicos" "${AUTH[@]}" --data-binary "@$payload_file")
  MEDID=$(echo "$RESP" | j "o.data&&o.data.id_medico")
  CODIGO=$(echo "$RESP" | j "o.codigo")

  if [ -n "$MEDID" ]; then
    HORARIO=$(curl -s -X POST "$BASE/api/v2/medicos/$MEDID/horarios" "${AUTH[@]}" \
      -d "{\"horarios\":$DIAS_LUNVIE}")
    echo "  [$cmp] $nombre $apellido — $especialidad → creado ($MEDID)"
    creados=$((creados+1))
  elif [ "$CODIGO" = "MEDICO_DUPLICADO" ] || echo "$RESP" | grep -qi "duplicad"; then
    echo "  [$cmp] $nombre $apellido — $especialidad → ya existía, se omite"
    existentes=$((existentes+1))
  else
    echo "  [$cmp] $nombre $apellido — $especialidad → FALLÓ: $RESP"
    fallidos=$((fallidos+1))
  fi
done
rm -f "$payload_file"

paso "3) Resumen"
TOTAL_MEDICOS=$(curl -s "$BASE/api/v2/medicos" "${AUTH[@]}" | j "o.data&&o.data.length")
echo "creados: $creados | ya existían: $existentes | fallidos: $fallidos"
echo "total de médicos en el sistema ahora: ${TOTAL_MEDICOS:-desconocido}"
echo ""
echo "Listo para correr k6/flujo-clinico.sh con catálogo real de médicos,"
echo "no contra un solo calendario."
