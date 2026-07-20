const { Router } = require('express');
const express = require('express');
const logger  = require('../../logger/logger');

const router = Router();

// Twilio envía el cuerpo como application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: false }));

/**
 * POST /webhooks/twilio/status
 * Twilio llama a este endpoint cada vez que cambia el estado de un mensaje
 * (queued → sent → delivered → read | failed | undelivered).
 * No requiere auth — Twilio firma la solicitud con X-Twilio-Signature.
 */
router.post('/status', (req, res) => {
  const {
    MessageSid,
    MessageStatus,
    To,
    From,
    ErrorCode,
    ErrorMessage,
  } = req.body;

  if (ErrorCode) {
    logger.warn(
      { MessageSid, MessageStatus, To, ErrorCode, ErrorMessage },
      '[Webhook/Twilio] Entrega fallida'
    );
  } else {
    logger.info(
      { MessageSid, MessageStatus, To, From },
      '[Webhook/Twilio] Cambio de estado'
    );
  }

  // Twilio espera 200/204 para confirmar recepción del webhook
  res.status(204).end();
});

/**
 * POST /webhooks/twilio/incoming
 * Twilio llama aquí cuando un paciente responde al WhatsApp.
 * Responde con TwiML vacío para no enviar nada de vuelta.
 */
router.post('/incoming', (req, res) => {
  const { From, Body } = req.body;
  logger.info({ From, Body }, '[Webhook/Twilio] Mensaje entrante recibido');
  res.type('text/xml').send('<Response></Response>');
});

module.exports = router;
