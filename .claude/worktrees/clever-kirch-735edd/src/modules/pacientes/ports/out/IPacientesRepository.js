class IPacientesRepository {
  async findByDocumento(tipoDocumento, numeroDocumento, conn) { throw new Error('No implementado'); }
  async findById(idPaciente, conn)                            { throw new Error('No implementado'); }
  async searchPaginated({ query, offset, limit, estado }, conn){ throw new Error('No implementado'); }
  async create(paciente, conn)                                { throw new Error('No implementado'); }
  async findByIdAny(idPaciente, conn)                         { throw new Error('No implementado'); }
  async update(idPaciente, fields, conn)                      { throw new Error('No implementado'); }
  async updateContact(idPaciente, contacto, conn)             { throw new Error('No implementado'); }
  async updateEstado(idPaciente, activo, conn)                { throw new Error('No implementado'); }
}

module.exports = { IPacientesRepository };
