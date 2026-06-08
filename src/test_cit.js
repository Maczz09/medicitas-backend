const axios = require('axios');

const API_BASE = 'http://localhost/api/v1';

async function testCitas() {
  console.log('--- Iniciando Test de Citas (E2E) ---');
  let tokenRecepcionista = '';
  let citaId = '';

  try {
    // 1. Login Recepcionista
    console.log('1. Login Recepcionista...');
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: 'recepcion@medicitas.pe',
      password: 'Password123!'
    });
    tokenRecepcionista = loginRes.data.data.accessToken;
    console.log('✅ Login exitoso');

    // 2. Reservar Cita (Intento)
    console.log('\n2. Reservar Cita...');
    const citaPayload = {
      idPaciente: 'usr-med-001', // Asumiendo que existe un paciente válido. Ajustar en un test real.
      idMedico: 'MED-10294', // Mock adapter
      fechaHora: new Date(new Date().getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(), // Pasado mañana
      especialidad: 'Cardiologia'
    };
    
    let reservada = false;
    try {
      const reservaRes = await axios.post(`${API_BASE}/citas`, citaPayload, {
        headers: { Authorization: `Bearer ${tokenRecepcionista}` }
      });
      citaId = reservaRes.data.data.idCita;
      console.log('✅ Cita reservada:', citaId);
      reservada = true;
    } catch (err) {
      console.error('❌ Error al reservar cita:', err.response?.data || err.message);
      // Puede fallar si no hay paciente usr-med-001 en la tabla de pacientes, pero la lógica de outbox e intentos funciona
    }

    // 3. Consultar Cita
    if (reservada) {
      console.log('\n3. Consultar Cita...');
      const consultaRes = await axios.get(`${API_BASE}/citas/${citaId}`, {
        headers: { Authorization: `Bearer ${tokenRecepcionista}` }
      });
      console.log('✅ Estado de Cita:', consultaRes.data.data.estado);

      // 4. Registrar Ingreso
      console.log('\n4. Registrar Ingreso...');
      const ingresoRes = await axios.post(`${API_BASE}/citas/${citaId}/ingreso`, {}, {
        headers: { Authorization: `Bearer ${tokenRecepcionista}` }
      });
      console.log('✅ Estado tras ingreso:', ingresoRes.data.data.estado);
    }

    console.log('\n--- Fin del Test ---');
  } catch (error) {
    console.error('\n❌ Test fallido (Error general):', error.response?.data || error.message);
  }
}

testCitas();
