const { DomainError } = require('../../../../shared/domain/errors');

const TIPOS_VALIDOS = Object.freeze({
  CONSULTA_GENERAL:       'CONSULTA_GENERAL',
  CONSULTA_ESPECIALIDAD:  'CONSULTA_ESPECIALIDAD',
  EMERGENCIA:             'EMERGENCIA',
  PROCEDIMIENTO:          'PROCEDIMIENTO',
});

class TipoConsulta {
  constructor(valor) {
    const normalizado = (valor || '').trim().toUpperCase();
    if (!Object.values(TIPOS_VALIDOS).includes(normalizado)) {
      throw new DomainError(
        'TIPO_CONSULTA_INVALIDO', 400,
        `Tipo de consulta inválido: '${valor}'. Valores permitidos: ${Object.values(TIPOS_VALIDOS).join(', ')}`
      );
    }
    this.valor = normalizado;
  }

  toString() { return this.valor; }
}

module.exports = { TipoConsulta, TIPOS_VALIDOS };
