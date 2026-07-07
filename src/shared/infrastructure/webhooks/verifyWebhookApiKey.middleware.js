const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const logger = require('../../logger/logger');

/**
 * Middleware factory para autenticar webhooks entrantes de servicios externos
 * (farmacia-api, aseguradora-prosalud-api) mediante una clave compartida.
 *
 * A diferencia de un fallback hardcodeado, si `envVarName` no está configurada
 * en el entorno, el middleware rechaza TODAS las peticiones (fail-closed) en
 * vez de aceptar cualquier valor.
 *
 * v2.1.0: acepta también un token de servicio (Authorization: Bearer <JWT
 * tipo:SERVICE>, emitido por POST /api/v2/auth/service-token) — client-
 * credentials en vez de una API key estática eterna. Ambos métodos coexisten
 * durante la ventana de deprecación de X-Webhook-Api-Key (ver VERSIONING.md).
 *
 * @param {string} envVarName — nombre de la variable de entorno con la clave esperada
 */
function verifyWebhookApiKey(envVarName) {
  return function (req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7).trim(), process.env.JWT_SECRET);
        if (payload.tipo === 'SERVICE') {
          req.serviceClient = { clientId: payload.sub, servicio: payload.servicio };
          return next();
        }
      } catch (err) {
        // Token ausente/inválido/expirado — cae al método legado en vez de
        // rechazar de inmediato, por si el caller aún no migró.
      }
    }

    const expectedKey = process.env[envVarName];

    if (!expectedKey) {
      logger.error(
        { envVarName },
        '[Webhook] Clave de autenticación no configurada — rechazando petición (fail-closed)'
      );
      return res.status(503).json({
        codigo: 'WEBHOOK_NO_CONFIGURADO',
        mensaje: 'El servicio no está configurado para recibir este webhook.',
      });
    }

    const receivedKey = req.headers['x-webhook-api-key'] || '';

    const expectedBuf = Buffer.from(expectedKey);
    const receivedBuf = Buffer.from(receivedKey);

    const isValid =
      expectedBuf.length === receivedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!isValid) {
      logger.warn({ envVarName }, '[Webhook] Clave de autenticación inválida o ausente');
      return res.status(401).json({
        codigo: 'WEBHOOK_API_KEY_INVALIDA',
        mensaje: 'No autorizado: X-Webhook-Api-Key inválida o ausente.',
      });
    }

    next();
  };
}

module.exports = { verifyWebhookApiKey };
