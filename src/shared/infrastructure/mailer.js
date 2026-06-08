const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

class MailerService {
  async sendOTP(email, otpCode) {
    const mailOptions = {
      from: `"MediCitas Auth" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Recuperación de Contraseña - MediCitas',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #0056b3;">MediCitas</h2>
          <p>Has solicitado recuperar tu contraseña. Utiliza el siguiente código de verificación para continuar con el proceso:</p>
          <div style="text-align: center; margin: 30px 0;">
            <span style="font-size: 32px; font-weight: bold; background: #f4f4f4; padding: 15px 30px; border-radius: 8px; letter-spacing: 8px;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #666; font-size: 14px;">Este código expirará en 15 minutos. Si tú no solicitaste este cambio, puedes ignorar este correo de forma segura.</p>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`[Mailer] Código OTP enviado a ${email}`);
    } catch (error) {
      console.error('[Mailer] Error al enviar el correo:', error);
      throw new Error('Fallo al enviar correo electrónico');
    }
  }
}

module.exports = new MailerService();
