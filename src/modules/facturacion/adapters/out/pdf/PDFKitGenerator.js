const PDFDocument = require('pdfkit');
const { DomainError } = require('../../../../../shared/domain/errors');

const APP_BASE_URL = process.env.APP_BASE_URL  || 'http://localhost';

// Genera el comprobante en PDF SIN tocar disco (regla del proyecto: todo en
// memoria para no crear cuellos de I/O bajo concurrencia). La ruta de descarga
// REGENERA el PDF al vuelo desde el registro de la BD; no se persiste el archivo.
class PDFKitGenerator {
  urlDescarga(comprobante) {
    return `${APP_BASE_URL}/api/v2/facturacion/comprobantes/${comprobante.id}/pdf`;
  }

  // Devuelve el PDF como Buffer en memoria (para la descarga y el envío por WhatsApp).
  async generarBuffer(comprobante) {
    try {
      return await this._construirBuffer(comprobante);
    } catch (err) {
      throw new DomainError('ERROR_GENERACION_PDF', 500,
        `No se pudo generar el PDF: ${err.message}`);
    }
  }

  // En la emisión: valida que el PDF se puede generar (descarta el buffer) y
  // devuelve solo la URL de descarga. No escribe nada a disco.
  async generar(comprobante) {
    await this.generarBuffer(comprobante); // valida temprano; si falla, marca ERROR
    return { urlDescarga: this.urlDescarga(comprobante) };
  }

  _construirBuffer(comprobante) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 40 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── Encabezado ────────────────────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold')
         .text('MediCitas', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
         .text('Plataforma de Atención Clínica y Gestión de Citas', { align: 'center' });
      doc.moveDown(0.5);

      // Línea separadora
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Tipo y número del comprobante ─────────────────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold')
         .text(comprobante.tipo, { align: 'center' });
      doc.fontSize(12).font('Helvetica')
         .text(`Nro: ${comprobante.numero}`, { align: 'center' });
      // En la descarga el PDF se regenera al vuelo: se usa la fecha de emisión
      // persistida (created_at) para que el documento no cambie entre descargas.
      const fechaEmision = comprobante.fechaEmision ? new Date(comprobante.fechaEmision) : new Date();
      doc.fontSize(10)
         .text(`Fecha: ${fechaEmision.toLocaleDateString('es-PE', {
           day: '2-digit', month: '2-digit', year: 'numeric',
         })}`, { align: 'center' });
      doc.moveDown(0.8);

      // ── Datos del paciente ────────────────────────────────────────────────────
      doc.fontSize(10).font('Helvetica-Bold').text('DATOS DEL PACIENTE');
      doc.font('Helvetica');
      if (comprobante.nombrePaciente) {
        doc.text(`Paciente: ${comprobante.nombrePaciente}`);
      }
      doc.text(`ID Paciente: ${comprobante.idPaciente}`);
      doc.text(`ID Cita: ${comprobante.idCita}`);
      doc.moveDown(0.8);

      // ── Detalle de pago ───────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').text('DETALLE DE PAGO');
      doc.font('Helvetica');
      doc.text(`Método de pago: ${comprobante.metodoPago}`);
      doc.moveDown(0.4);

      if (comprobante.tieneCobertura && comprobante.montoCubiertoSeguro > 0) {
        doc.text(`Subtotal consulta:`, { continued: true })
           .text(` S/ ${comprobante.montoTotal.toFixed(2)}`, { align: 'right' });
        doc.text(`Cobertura de seguro:`, { continued: true })
           .text(` -S/ ${comprobante.montoCubiertoSeguro.toFixed(2)}`, { align: 'right' });

        // Línea separadora antes del total
        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font('Helvetica-Bold')
           .text(`TOTAL A PAGAR:`, { continued: true })
           .text(` S/ ${comprobante.montoCopago.toFixed(2)}`, { align: 'right' });
      } else {
        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold')
           .text(`TOTAL:`, { continued: true })
           .text(` S/ ${comprobante.montoTotal.toFixed(2)}`, { align: 'right' });
      }

      doc.moveDown(1.5);

      // ── Pie de página ─────────────────────────────────────────────────────────
      doc.font('Helvetica').fontSize(8)
         .text('Gracias por su preferencia — MediCitas', { align: 'center' })
         .text('Este comprobante es válido como constancia de pago.', { align: 'center' });

      doc.end();
    });
  }
}

module.exports = { PDFKitGenerator };
