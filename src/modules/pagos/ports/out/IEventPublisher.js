class IEventPublisher {
  async publish(connection, evento, payload, correlationId) { throw new Error('No implementado'); }
}

module.exports = { IEventPublisher };
