const axios = require('axios');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

async function testHistoriaClinica() {
  const dbConfig = {
    host: 'medicitas_mysql',
    user: 'medicitas_app',
    password: 'app_secret_medicitas',
  };

  const conn = await mysql.createConnection(dbConfig);
  console.log('✅ Conectado a BD para preparación de datos de prueba');

  try {
    // 1. Obtener un médico
    const [medicos] = await conn.execute(`
      SELECT u.id_usuario as id, u.email, r.nombre as rol_nombre 
      FROM medicitas_users.usuarios u 
      JOIN medicitas_users.roles r ON u.id_rol = r.id_rol 
      WHERE r.nombre = 'Médico' LIMIT 1
    `);
    if (medicos.length === 0) throw new Error('No hay médicos de prueba.');
    const medico = medicos[0];
    
    // Iniciar sesión
    const loginRes = await axios.post('http://medicitas_backend:3000/api/v1/auth/login', {
      email: medico.email,
      password: 'Password123!' // asumiendo password genérico
    }).catch(err => {
        if(err.response?.status === 401) {
            console.log('⚠️ Password por defecto no funcionó. Voy a generar un token manual simulando a login');
            return null;
        }
        throw err;
    });

    let token = loginRes?.data?.token;

    if (!token) {
        const jwt = require('jsonwebtoken');
        token = jwt.sign({ sub: medico.id, email: medico.email, rolNombre: medico.rol_nombre }, 'super_secret_jwt_medicitas_2026', { expiresIn: '1h' });
    }
    console.log('✅ Autenticado como Médico:', medico.email);

    // 2. Obtener un paciente
    const [pacientes] = await conn.execute(`SELECT * FROM svc_pac.pacientes LIMIT 1`);
    let pacienteId;
    if (pacientes.length === 0) {
      pacienteId = uuidv4();
      await conn.execute(`INSERT INTO svc_pac.pacientes (id_paciente, numero_documento, nombre, apellido, fecha_nacimiento, sexo, tipo_documento, telefono) VALUES (?, '11223344', 'Juan', 'Perez Test', '1990-01-01', 'M', 'DNI', '999888777')`, [pacienteId]);
    } else {
      pacienteId = pacientes[0].id_paciente;
    }
    console.log('✅ Paciente de prueba listo:', pacienteId);

    // 3. Crear expediente si no existe
    const [expedientes] = await conn.execute(`SELECT * FROM svc_hcl.expedientes WHERE id_paciente = ?`, [pacienteId]);
    let expedienteId;
    if (expedientes.length === 0) {
        expedienteId = `HCL-${Date.now()}`;
        await conn.execute(`INSERT INTO svc_hcl.expedientes (id_expediente, id_paciente, grupo_sanguineo) VALUES (?, ?, 'O+')`, [expedienteId, pacienteId]);
    } else {
        expedienteId = expedientes[0].id_expediente;
    }
    console.log('✅ Expediente de prueba listo:', expedienteId);

    // 4. Crear cita en estado EnCurso
    const idCita = `CIT-TEST-${Date.now()}`;
    await conn.execute(`INSERT INTO svc_cit.citas (id_cita, id_paciente, id_medico, especialidad, fecha_hora, estado) VALUES (?, ?, ?, 'Medicina General', NOW(), 'EnCurso')`, [idCita, pacienteId, medico.id]);
    console.log('✅ Cita EnCurso lista:', idCita);

    // 5. Testear Endpoint de Registro de Consulta
    console.log('\n🚀 Ejecutando POST /api/v1/historias-clinicas/:idPaciente/encuentros...');
    
    const payload = {
        idCita: idCita,
        diagnosticoCie10: 'J01.9', // Sinusitis aguda
        descripcion: 'Paciente presenta dolor facial y congestión nasal.',
        prescripciones: [
            {
                medicamento: 'Amoxicilina 500mg',
                dosis: '1 tableta cada 8 horas',
                indicaciones: 'Tomar con alimentos',
                cantidad: '21'
            },
            {
                medicamento: 'Ibuprofeno 400mg',
                dosis: '1 tableta cada 8 horas',
                indicaciones: 'Solo si hay dolor',
                cantidad: '10'
            }
        ]
    };

    const res = await axios.post(`http://medicitas_backend:3000/api/v1/historias-clinicas/${pacienteId}/encuentros`, payload, {
        headers: { Authorization: `Bearer ${token}` }
    });

    console.log('✅ RESPUESTA DEL SERVIDOR (POST Encuentro):');
    console.log(JSON.stringify(res.data, null, 2));

    // 6. Testear Resumen
    console.log('\n🚀 Ejecutando GET /api/v1/historias-clinicas/:idPaciente/resumen...');
    const resResumen = await axios.get(`http://medicitas_backend:3000/api/v1/historias-clinicas/${pacienteId}/resumen`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ RESPUESTA DEL SERVIDOR (GET Resumen):');
    console.log(JSON.stringify(resResumen.data, null, 2));

    // 7. Testear Outbox Events
    const [eventos] = await conn.execute(`SELECT tipo_evento as evento, payload FROM svc_hcl.outbox WHERE estado = 'PENDIENTE' ORDER BY creado_en DESC LIMIT 3`);
    console.log('\n✅ EVENTOS PUBLICADOS EN OUTBOX (Asíncronos):');
    eventos.forEach(e => {
        console.log(`- Evento: ${e.evento}`);
        // console.log(`  Payload: ${e.payload}`);
    });

  } catch (err) {
    console.error('\n❌ ERROR DURANTE EL TEST:');
    if (err.response) {
        console.error(err.response.data);
    } else {
        console.error(err.message);
    }
  } finally {
    await conn.end();
  }
}

testHistoriaClinica();
