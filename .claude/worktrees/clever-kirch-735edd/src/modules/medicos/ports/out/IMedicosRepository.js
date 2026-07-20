class IMedicosRepository {
  async findByCmp(cmp)                                        { throw new Error('No implementado'); }
  async findById(idMedico)                                    { throw new Error('No implementado'); }
  async findAll()                                             { throw new Error('No implementado'); }
  async findByIdAny(idMedico)                                 { throw new Error('No implementado'); }
  async update(idMedico, fields)                              { throw new Error('No implementado'); }
  async create(medico)                                        { throw new Error('No implementado'); }
  async getHorarios(idMedico)                                 { throw new Error('No implementado'); }
  async getBloqueos(idMedico)                                 { throw new Error('No implementado'); }
  async saveHorarios(idMedico, horarios)                      { throw new Error('No implementado'); }
  async saveBloqueo(bloqueo)                                  { throw new Error('No implementado'); }
}

module.exports = { IMedicosRepository };
