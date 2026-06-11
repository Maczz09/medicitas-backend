class IPagosRepository {
  async findById(id)          { throw new Error('No implementado'); }
  async findByIdCita(idCita)  { throw new Error('No implementado'); }
  async save(pago, connection) { throw new Error('No implementado'); }
  async update(pago, connection){ throw new Error('No implementado'); }
}

module.exports = { IPagosRepository };
