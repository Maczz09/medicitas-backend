'use strict';

const { DomainError } = require('../domain/errors');

/**
 * Autorización a nivel de RECURSO (no solo de rol).
 *
 * `soloMedicoPropietario(paramId)` exige que un usuario con rol Médico solo
 * pueda operar sobre su propio recurso: el id del path (`req.params[paramId]`)
 * debe coincidir con su `idMedico` del token. Sin esto, tener rol Médico
 * bastaba para editar la agenda / recursos de OTRO médico (IDOR).
 *
 * Auditor e INTERNAL están exentos (gestión administrativa / S2S legítima).
 */
function soloMedicoPropietario(paramId = 'id') {
  return (req, res, next) => {
    const rol = String(req.user?.rolNombre || '').toUpperCase();
    if (rol === 'AUDITOR' || rol === 'INTERNAL') return next();

    if (rol === 'MÉDICO' || rol === 'MEDICO') {
      const idRecurso = req.params[paramId];
      if (!req.user.idMedico || req.user.idMedico !== idRecurso) {
        return next(new DomainError(
          'RECURSO_AJENO',
          403,
          'No puedes operar sobre recursos de otro médico.'
        ));
      }
      return next();
    }

    // Otros roles: la restricción de rol de la ruta ya decidió; aquí no aplica.
    return next();
  };
}

module.exports = { soloMedicoPropietario };
