'use strict';

/**
 * Schemas Zod centralizados para validación de request bodies.
 *
 * Se aplican vía el middleware `validate(schema)` en los endpoints POST
 * críticos. Zod da errores POR CAMPO (qué campo, qué regla violó) que el
 * error handler devuelve en `detalles` — nunca un 500 por un body malformado.
 *
 * `.strict()` no se usa para permitir campos extra tolerados por los use cases,
 * pero cada campo declarado sí valida tipo + regla de negocio.
 */

const { z } = require('zod');

const noVacio = (campo) => z.string({ error: `${campo} es obligatorio` }).trim().min(1, `${campo} no puede estar vacío`);

// ── Citas: POST /api/v2/citas ──────────────────────────────────────────────
const crearCitaSchema = z.object({
  idPaciente: noVacio('idPaciente'),
  idMedico: noVacio('idMedico'),
  especialidad: noVacio('especialidad'),
  fechaHora: z
    .string({ error: 'fechaHora es obligatoria' })
    .datetime({ offset: true, message: 'fechaHora debe ser una fecha-hora ISO 8601 válida (ej. 2026-07-10T15:00:00Z)' }),
});

// ── Pagos: POST /api/v2/pagos ──────────────────────────────────────────────
const METODOS_PAGO = ['EFECTIVO', 'TARJETA', 'YAPE', 'PLIN', 'TRANSFERENCIA'];
const TIPOS_COMPROBANTE = ['BOLETA', 'FACTURA'];

const confirmarPagoSchema = z.object({
  idCita: noVacio('idCita'),
  idPaciente: noVacio('idPaciente'),
  metodoPago: z.enum(METODOS_PAGO, { error: `metodoPago debe ser uno de: ${METODOS_PAGO.join(', ')}` }),
  montoTotal: z.coerce.number({ error: 'montoTotal debe ser numérico' }).positive('montoTotal debe ser mayor que 0'),
  montoCopago: z.coerce.number({ error: 'montoCopago debe ser numérico' }).min(0, 'montoCopago no puede ser negativo'),
  montoCubiertoSeguro: z.coerce.number().min(0, 'montoCubiertoSeguro no puede ser negativo').optional(),
  tipoComprobante: z.enum(TIPOS_COMPROBANTE).optional(),
  idValidacionCobertura: z.string().trim().optional().nullable(),
  codigoAutorizacionSeguro: z.string().trim().optional().nullable(),
  observaciones: z.string().trim().max(500, 'observaciones no puede exceder 500 caracteres').optional().nullable(),
}).refine((d) => d.montoCopago <= d.montoTotal, {
  error: 'montoCopago no puede ser mayor que montoTotal',
  path: ['montoCopago'],
});

// ── Pacientes: POST /api/v2/pacientes ──────────────────────────────────────
const TIPOS_DOC = ['DNI', 'CE', 'PASAPORTE'];
const SEXOS = ['M', 'F', 'Otro'];

const crearPacienteSchema = z.object({
  nombre: noVacio('nombre').max(100),
  apellido: noVacio('apellido').max(100),
  tipo_documento: z.enum(TIPOS_DOC, { error: `tipo_documento debe ser uno de: ${TIPOS_DOC.join(', ')}` }),
  numero_documento: noVacio('numero_documento'),
  fecha_nacimiento: z
    .string({ error: 'fecha_nacimiento es obligatoria' })
    .regex(/^\d{4}-\d{2}-\d{2}/, 'fecha_nacimiento debe tener formato YYYY-MM-DD')
    .refine((f) => new Date(f) <= new Date(), { error: 'fecha_nacimiento no puede estar en el futuro' }),
  sexo: z.enum(SEXOS, { error: `sexo debe ser uno de: ${SEXOS.join(', ')}` }),
  telefono: z.string().trim().max(20).optional().nullable(),
  email: z.string().email('email no tiene un formato válido').optional().nullable().or(z.literal('')),
  direccion: z.string().trim().max(200).optional().nullable(),
}).superRefine((d, ctx) => {
  // Reglas de formato de documento por tipo (regla de negocio, no solo formato)
  if (d.tipo_documento === 'DNI' && !/^\d{8}$/.test(d.numero_documento)) {
    ctx.addIssue({ code: 'custom', path: ['numero_documento'], message: 'El DNI debe tener exactamente 8 dígitos numéricos' });
  }
  if (d.tipo_documento === 'CE' && !/^[A-Za-z0-9]{9}$/.test(d.numero_documento)) {
    ctx.addIssue({ code: 'custom', path: ['numero_documento'], message: 'El CE debe tener exactamente 9 caracteres alfanuméricos' });
  }
  if (d.tipo_documento === 'PASAPORTE' && d.numero_documento.length > 15) {
    ctx.addIssue({ code: 'custom', path: ['numero_documento'], message: 'El pasaporte no puede exceder 15 caracteres' });
  }
});

// ── Historia Clínica: POST /api/v2/historias-clinicas/:idPaciente/encuentros ─
const registrarEncuentroSchema = z.object({
  idCita: noVacio('idCita'),
  diagnosticoCie10: noVacio('diagnosticoCie10').regex(/^[A-Z]\d{1,3}(\.\d{1,2})?$/i, 'diagnosticoCie10 debe ser un código CIE-10 válido (ej. J10, I10.9)'),
  motivoConsulta: z.string().trim().max(1000).optional().nullable(),
  notasClinicas: z.string().trim().max(4000).optional().nullable(),
  prescripciones: z.array(z.object({
    medicamento: noVacio('medicamento'),
    dosis: z.string().trim().optional().nullable(),
    cantidad: z.coerce.number().int().positive('cantidad debe ser un entero positivo').optional(),
    frecuencia: z.string().trim().optional().nullable(),
    duracion: z.string().trim().optional().nullable(),
    indicaciones: z.string().trim().optional().nullable(),
  })).optional(),
}).passthrough();

// ── Coberturas: POST /api/v2/coberturas/validar ────────────────────────────
const validarCoberturaSchema = z.object({
  idPaciente: noVacio('idPaciente'),
  idAseguradora: noVacio('idAseguradora'),
  numeroPoliza: noVacio('numeroPoliza'),
  tipoConsulta: noVacio('tipoConsulta'),
}).passthrough();

module.exports = {
  crearCitaSchema,
  confirmarPagoSchema,
  crearPacienteSchema,
  registrarEncuentroSchema,
  validarCoberturaSchema,
};
