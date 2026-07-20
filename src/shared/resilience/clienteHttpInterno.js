'use strict';

const axios = require('axios');
const http = require('http');
const https = require('https');
const { BULKHEAD_MAX_SOCKETS } = require('./config');

/**
 * Cliente axios persistente con bulkhead para adaptadores S2S INTERNOS
 * (llamadas entre módulos del mismo monolito, vía localhost/red compartida).
 *
 * Antes, los 10 adaptadores internos hacían axios.get/patch directo,
 * module-level, sin instancia propia — compartiendo el agente HTTP global de
 * Node con TODO el resto del proceso. Con esto cada adaptador aísla sus
 * propios sockets (igual que ya hacían los 2 gateways externos), así una
 * ráfaga de llamadas a un módulo no agota los sockets disponibles para el
 * resto de llamadas salientes del proceso.
 *
 * Sin timeout ni headers de autenticación por defecto: el timeout va
 * por-request (es exponencial por intento — ver
 * config.js#obtenerTimeoutParaIntento) y cada adaptador sigue mandando su
 * propio header Authorization por-request (env var estático o JWT
 * autogenerado, según el adaptador) — este factory no toca el mecanismo de
 * auth de ninguno.
 *
 * @param {object} opciones
 * @param {string} opciones.baseUrl
 * @returns {import('axios').AxiosInstance}
 */
function crearClienteInterno({ baseUrl }) {
  return axios.create({
    baseURL: baseUrl,
    httpAgent: new http.Agent({ maxSockets: BULKHEAD_MAX_SOCKETS }),
    httpsAgent: new https.Agent({ maxSockets: BULKHEAD_MAX_SOCKETS }),
  });
}

module.exports = { crearClienteInterno };
