// La BD se mockea: aquí se prueba la LÓGICA del middleware (cache hit, en
// proceso, primera vez, métodos exentos), no el acceso a MySQL.
jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));

const db = require('../../../src/config/database');
const { checkIdempotency, requireIdempotencyKey } = require('../../../src/shared/infrastructure/api_idempotency.middleware');
const { DomainError } = require('../../../src/shared/domain/errors');

function reqMock({ method = 'POST', key = 'KEY-1', handled = false } = {}) {
  const req = { method, headers: {}, originalUrl: '/api/v2/pagos' };
  if (key) req.headers['idempotency-key'] = key;
  if (handled) req._idempotencyHandled = true;
  return req;
}

function resMock() {
  const res = { statusCode: 200 };
  res.status = jest.fn().mockImplementation((code) => { res.statusCode = code; return res; });
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('requireIdempotencyKey', () => {
  test('sin header pasa un DomainError 400 a next', () => {
    const next = jest.fn();
    requireIdempotencyKey(reqMock({ key: null }), resMock(), next);
    expect(next).toHaveBeenCalledWith(expect.any(DomainError));
    expect(next.mock.calls[0][0].httpStatus).toBe(400);
  });

  test('con header sigue la cadena', () => {
    const next = jest.fn();
    requireIdempotencyKey(reqMock(), resMock(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('checkIdempotency', () => {
  test('GET y OPTIONS pasan sin tocar la BD', async () => {
    const next = jest.fn();
    await checkIdempotency(reqMock({ method: 'GET' }), resMock(), next);
    await checkIdempotency(reqMock({ method: 'OPTIONS' }), resMock(), next);
    expect(db.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  test('sin Idempotency-Key pasa sin tocar la BD', async () => {
    const next = jest.fn();
    await checkIdempotency(reqMock({ key: null }), resMock(), next);
    expect(db.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('la segunda ejecución del middleware en la misma request NO se auto-bloquea', async () => {
    const next = jest.fn();
    await checkIdempotency(reqMock({ handled: true }), resMock(), next);
    expect(db.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test('clave ya procesada: repite la respuesta cacheada sin ejecutar el handler', async () => {
    db.query.mockResolvedValueOnce([[{ idempotency_key: 'KEY-1', status_code: 201, response_body: { id: 'PAG-9' } }]]);
    const res = resMock();
    const next = jest.fn();

    await checkIdempotency(reqMock(), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'PAG-9' });
    expect(next).not.toHaveBeenCalled();
  });

  test('clave en proceso (sin status_code): responde 409 PETICION_EN_PROCESO', async () => {
    db.query.mockResolvedValueOnce([[{ idempotency_key: 'KEY-1', status_code: null }]]);
    const res = resMock();
    const next = jest.fn();

    await checkIdempotency(reqMock(), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'PETICION_EN_PROCESO' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('clave nueva: registra la petición, sigue la cadena y guarda la respuesta al responder', async () => {
    db.query
      .mockResolvedValueOnce([[]]) // SELECT: no existe
      .mockResolvedValueOnce([{}]) // INSERT inicio
      .mockResolvedValueOnce([{}]); // UPDATE con la respuesta
    const res = resMock();
    const next = jest.fn();

    await checkIdempotency(reqMock(), res, next);

    expect(next).toHaveBeenCalled();
    expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT'), ['KEY-1', 'POST', '/api/v2/pagos']);

    // El handler responde → el middleware persiste status y body
    res.statusCode = 201;
    res.json({ id: 'PAG-1' });
    await new Promise(process.nextTick); // el UPDATE es fire-and-forget

    expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE'),
      [JSON.stringify({ id: 'PAG-1' }), 201, 'KEY-1']);
  });

  test('error de BD se propaga a next(err)', async () => {
    db.query.mockRejectedValueOnce(new Error('MySQL caído'));
    const next = jest.fn();
    await checkIdempotency(reqMock(), resMock(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
