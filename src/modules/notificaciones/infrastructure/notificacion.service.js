class NotificacionService {
  async enviarSMS(telefono, mensaje) {
    console.log(`[Notificación - SMS] 📱 Enviando a ${telefono || 'DEFAULT_PHONE'}:\n"${mensaje}"`);
    await new Promise(res => setTimeout(res, 300));
  }

  async enviarEmail(correo, asunto, cuerpo) {
    console.log(`[Notificación - Email] 📧 Enviando a ${correo || 'DEFAULT_EMAIL'}\nAsunto: ${asunto}\nCuerpo:\n${cuerpo}`);
    await new Promise(res => setTimeout(res, 500));
  }
}

module.exports = NotificacionService;
