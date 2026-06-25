const db = require('../../config/database');

async function checkIdempotency(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS') {
    return next();
  }

  // El middleware está registrado globalmente y, en algunas rutas, también de forma
  // explícita. Sin esta guarda, la segunda ejecución vería la clave que insertó la
  // primera (status NULL) y respondería 409 PETICION_EN_PROCESO en la primera petición.
  if (req._idempotencyHandled) {
    return next();
  }
  req._idempotencyHandled = true;

  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return next(); // Si no envía header, no se aplica idempotencia
  }

  try {
    const [rows] = await db.query(
      `SELECT * FROM medicitas_users.peticiones_idempotentes WHERE idempotency_key = ?`,
      [idempotencyKey]
    );

    if (rows.length > 0) {
      const cached = rows[0];
      if (cached.status_code) {
        // Petición ya procesada, devolver la misma respuesta
        return res.status(cached.status_code).json(cached.response_body);
      } else {
        // En proceso
        return res.status(409).json({
          codigo: 'PETICION_EN_PROCESO',
          mensaje: 'Esta petición ya se encuentra en procesamiento'
        });
      }
    }

    // Registrar inicio de la petición
    await db.query(
      `INSERT INTO medicitas_users.peticiones_idempotentes (idempotency_key, metodo, ruta) VALUES (?, ?, ?)`,
      [idempotencyKey, req.method, req.originalUrl]
    );

    // Interceptar la respuesta para guardarla
    const originalJson = res.json;
    res.json = function(body) {
      res.json = originalJson;
      const responseBody = body;
      const statusCode = res.statusCode;

      // Guardar de forma asíncrona la respuesta final
      db.query(
        `UPDATE medicitas_users.peticiones_idempotentes SET response_body = ?, status_code = ? WHERE idempotency_key = ?`,
        [JSON.stringify(responseBody), statusCode, idempotencyKey]
      ).catch(e => console.error('[Idempotency] Error actualizando clave', e));

      return res.json(body);
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { checkIdempotency };
