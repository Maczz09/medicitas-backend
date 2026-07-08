const { SemanaInvalidaError } = require('../horarios.errors');

// Normaliza cualquier fecha al lunes de su semana, usando SIEMPRE componentes
// de fecha LOCAL (getFullYear/getMonth/getDate), nunca toISOString().split('T')[0]
// — ese desplaza por el offset UTC-5 de Lima cerca de medianoche, el mismo
// bug que ya mordió este proyecto varias veces (tolerancia de citas, cache
// de disponibilidad). America/Lima no tiene DST, así que no hay transición
// que complique esto más allá del desplazamiento UTC de siempre.
class SemanaISO {
  constructor(fecha) {
    const d = SemanaISO._aFechaLocal(fecha);
    if (Number.isNaN(d.getTime())) {
      throw new SemanaInvalidaError(`Fecha inválida: ${fecha}`);
    }

    const diaSemana = d.getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
    const offsetHastaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;

    const lunes = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetHastaLunes);
    this.valor = SemanaISO._formatoLocal(lunes);
  }

  static _aFechaLocal(fecha) {
    if (fecha instanceof Date) {
      return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    }
    // 'YYYY-MM-DD' — forzar T00:00:00 para que el motor lo interprete en
    // hora local, no en UTC (new Date('YYYY-MM-DD') a secas SÍ es UTC).
    return new Date(`${fecha}T00:00:00`);
  }

  static _formatoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  toString() {
    return this.valor;
  }
}

module.exports = { SemanaISO };
