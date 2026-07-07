'use strict';

/**
 * Utilidades de enmascarado de PII (Personally Identifiable Information).
 *
 * REGLA ESTRICTA (sistema médico): nunca registrar en logs datos que
 * identifiquen a un paciente en texto plano — documento, teléfono, email,
 * nombre completo, dirección, diagnóstico. Se enmascara dejando lo mínimo
 * necesario para diagnosticar (últimos dígitos) sin exponer el dato completo.
 */

function maskDocumento(valor) {
  if (!valor) return valor;
  const s = String(valor);
  if (s.length <= 4) return '****';
  return `${s.slice(0, 2)}${'*'.repeat(s.length - 4)}${s.slice(-2)}`;
}

function maskTelefono(valor) {
  if (!valor) return valor;
  const s = String(valor).replace(/\s+/g, '');
  if (s.length <= 4) return '****';
  return `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

function maskEmail(valor) {
  if (!valor) return valor;
  const s = String(valor);
  const at = s.indexOf('@');
  if (at <= 1) return `***${s.slice(at)}`;
  return `${s[0]}***${s.slice(at)}`;
}

module.exports = { maskDocumento, maskTelefono, maskEmail };
