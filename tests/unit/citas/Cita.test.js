const { Cita, CitaEstado } = require('../../../src/modules/citas/domain/entities/Cita');
const { TransicionEstadoInvalidaError, FechaHoraInvalidaError } = require('../../../src/modules/citas/domain/cita.errors');

// Helper: fecha de HOY a una hora dada (registrarIngreso exige mismo día local)
function hoyALas(horas, minutos = 0) {
  const d = new Date();
  d.setHours(horas, minutos, 0, 0);
  return d;
}

function enDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d;
}

describe('Cita — máquina de estados', () => {
  const base = { idPaciente: 'PAC-1', idMedico: 'MED-1', especialidad: 'Cardiología' };

  test('crear() arranca en Pendiente con id generado', () => {
    const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
    expect(cita.estado).toBe(CitaEstado.PENDIENTE);
    expect(cita.id).toMatch(/^CIT-/);
    expect(cita.estaActiva()).toBe(true);
  });

  describe('registrarIngreso', () => {
    test('pasa a En_Atencion si la cita es hoy', () => {
      const cita = Cita.crear({ ...base, fechaHora: hoyALas(23, 59) });
      cita.registrarIngreso();
      expect(cita.estado).toBe(CitaEstado.EN_ATENCION);
    });

    test('rechaza el ingreso si la cita NO es hoy', () => {
      const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
      expect(() => cita.registrarIngreso()).toThrow(TransicionEstadoInvalidaError);
      expect(cita.estado).toBe(CitaEstado.PENDIENTE);
    });

    test('rechaza el ingreso desde un estado distinto de Pendiente', () => {
      const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.COMPLETADA });
      expect(() => cita.registrarIngreso()).toThrow(TransicionEstadoInvalidaError);
    });
  });

  describe('completar', () => {
    test('solo desde En_Atencion', () => {
      const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.EN_ATENCION });
      cita.completar();
      expect(cita.estado).toBe(CitaEstado.COMPLETADA);
      expect(cita.estaActiva()).toBe(false);
    });

    test('desde Pendiente lanza error', () => {
      const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
      expect(() => cita.completar()).toThrow(TransicionEstadoInvalidaError);
    });
  });

  describe('cancelar', () => {
    test('cancelable desde Pendiente y En_Atencion', () => {
      const pendiente = Cita.crear({ ...base, fechaHora: enDias(1) });
      pendiente.cancelar();
      expect(pendiente.estado).toBe(CitaEstado.CANCELADA);

      const enAtencion = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.EN_ATENCION });
      enAtencion.cancelar();
      expect(enAtencion.estado).toBe(CitaEstado.CANCELADA);
    });

    test('no cancelable desde Completada ni No_Asistida', () => {
      for (const estado of [CitaEstado.COMPLETADA, CitaEstado.NO_ASISTIDA, CitaEstado.CANCELADA]) {
        const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado });
        expect(() => cita.cancelar()).toThrow(TransicionEstadoInvalidaError);
      }
    });
  });

  describe('revertirIngreso', () => {
    test('vuelve de En_Atencion a Pendiente', () => {
      const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.EN_ATENCION });
      cita.revertirIngreso();
      expect(cita.estado).toBe(CitaEstado.PENDIENTE);
    });

    test('desde otro estado lanza error', () => {
      const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
      expect(() => cita.revertirIngreso()).toThrow(TransicionEstadoInvalidaError);
    });
  });

  describe('expirar (tolerancia de llegada → No_Asistida)', () => {
    test('una Pendiente expira a No_Asistida', () => {
      const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
      expect(cita.expirar()).toBe(cita);
      expect(cita.estado).toBe(CitaEstado.NO_ASISTIDA);
    });

    test('una no-Pendiente NO expira (devuelve null y no cambia)', () => {
      const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.EN_ATENCION });
      expect(cita.expirar()).toBeNull();
      expect(cita.estado).toBe(CitaEstado.EN_ATENCION);
    });
  });

  describe('reprogramar', () => {
    test('cambia la fecha y devuelve anterior/nueva', () => {
      const original = enDias(1);
      const nueva = enDias(3);
      const cita = Cita.crear({ ...base, fechaHora: original });
      const r = cita.reprogramar(nueva);
      expect(r.fechaAnterior).toEqual(original);
      expect(r.fechaNueva).toEqual(nueva);
      expect(cita.fechaHora).toEqual(nueva);
    });

    test('rechaza fecha en el pasado', () => {
      const cita = Cita.crear({ ...base, fechaHora: enDias(1) });
      expect(() => cita.reprogramar(enDias(-1))).toThrow(FechaHoraInvalidaError);
    });

    test('solo desde Pendiente', () => {
      const cita = new Cita({ ...base, id: 'CIT-X', fechaHora: hoyALas(10), estado: CitaEstado.EN_ATENCION });
      expect(() => cita.reprogramar(enDias(2))).toThrow(TransicionEstadoInvalidaError);
    });
  });
});
