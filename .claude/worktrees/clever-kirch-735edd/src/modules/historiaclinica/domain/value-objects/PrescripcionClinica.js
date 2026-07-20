class PrescripcionClinica {
  constructor({ medicamento, dosis, indicaciones, cantidad }) {
    if (!medicamento || !dosis || !cantidad) {
      throw new Error('PrescripcionClinica requiere: medicamento, dosis, cantidad');
    }
    // Inmutable
    Object.freeze(Object.assign(this, { medicamento, dosis, indicaciones: indicaciones || '', cantidad }));
  }
}

module.exports = { PrescripcionClinica };
