const { Comprobante, EstadoComprobante } = require('../../../src/modules/facturacion/domain/entities/Comprobante');
const { DomainError } = require('../../../src/shared/domain/errors');

const datosBase = {
  idPago: 'PAG-1',
  idPaciente: 'PAC-1',
  idCita: 'CIT-1',
  tipo: 'BOLETA',
  numero: 'B001-00000042',
  montoTotal: 100,
  montoCubiertoSeguro: 80,
  montoCopago: 20,
  metodoPago: 'TARJETA',
  tieneCobertura: true,
  correlationId: 'corr-1',
};

describe('Comprobante — ciclo de vida', () => {
  test('crear() arranca PENDIENTE con id FAC-', () => {
    const c = Comprobante.crear(datosBase);
    expect(c.estado).toBe(EstadoComprobante.PENDIENTE);
    expect(c.id).toMatch(/^FAC-/);
    expect(c.estaPendiente()).toBe(true);
    expect(c.intentosGeneracion).toBe(0);
  });

  test('marcarEmitido: PENDIENTE → EMITIDO (PDF en memoria: rutaPdf queda null)', () => {
    const c = Comprobante.crear(datosBase);
    c.marcarEmitido(null, 'http://localhost/api/v2/facturacion/comprobantes/X/pdf', 'Ana García');
    expect(c.estado).toBe(EstadoComprobante.EMITIDO);
    expect(c.estaEmitido()).toBe(true);
    expect(c.rutaPdf).toBeNull();
    expect(c.urlDescarga).toContain('/pdf');
    expect(c.nombrePaciente).toBe('Ana García');
  });

  test('marcarEmitido dos veces lanza TRANSICION_INVALIDA', () => {
    const c = Comprobante.crear(datosBase);
    c.marcarEmitido(null, 'url', 'Ana');
    expect(() => c.marcarEmitido(null, 'url', 'Ana')).toThrow(DomainError);
  });

  test('marcarError: registra mensaje e incrementa intentos', () => {
    const c = Comprobante.crear(datosBase);
    c.marcarError('Fallo al generar PDF');
    expect(c.estado).toBe(EstadoComprobante.ERROR);
    expect(c.estaEnError()).toBe(true);
    expect(c.errorMensaje).toBe('Fallo al generar PDF');
    expect(c.intentosGeneracion).toBe(1);
  });

  test('puedeReintentar respeta el máximo', () => {
    const c = Comprobante.crear(datosBase);
    c.marcarError('1');
    c.marcarError('2');
    expect(c.puedeReintentar(3)).toBe(true);
    c.marcarError('3');
    expect(c.puedeReintentar(3)).toBe(false);
  });

  test('fechaEmision viaja desde la BD (created_at) para regenerar el PDF con fecha estable', () => {
    const c = new Comprobante({ ...datosBase, id: 'FAC-1', estado: 'EMITIDO', fechaEmision: '2026-07-10T10:00:00Z' });
    expect(c.fechaEmision).toBe('2026-07-10T10:00:00Z');
    // Sin fecha (emisión nueva, aún no persistida) queda null y el PDF usa "hoy"
    expect(Comprobante.crear(datosBase).fechaEmision).toBeNull();
  });
});
