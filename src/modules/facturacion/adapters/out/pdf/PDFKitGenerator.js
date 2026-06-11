const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const { DomainError } = require('../../../../../shared/domain/errors');

const STORAGE_PATH = process.env.STORAGE_PATH || './storage/comprobantes';
const APP_BASE_URL = process.env.APP_BASE_URL  || 'http://localhost';

class PDFKitGenerator {
  async generar(comprobante) {
    // Asegurar que el directorio existe
    if (!fs.existsSync(STORAGE_PATH)) {
      fs.mkdirSync(STORAGE_PATH, { recursive: true });
    }

    const nombreArchivo = `${comprobante.numero}.pdf`;
    const rutaPdf       = path.join(STORAGE_PATH, nombreArchivo);
    const urlDescarga   = `${APP_BASE_URL}/api/v1/facturacion/comprobantes/${comprobante.id}/pdf`;

    try {
      await this._generarPDF(comprobante, rutaPdf);
      return { rutaPdf, urlDescarga };
    } catch (err) {
      // Limpiar archivo parcial si existe
      if (fs.existsSync(rutaPdf)) {
        fs.unlinkSync(rutaPdf);
      }
      throw new DomainError('ERROR_GENERACION_PDF', 500,
        `No se pudo generar el PDF: ${err.message}`);
    }
  }

  _generarPDF(comprobante, rutaPdf) {
    return new Promise((resolve, reject) => {
      const doc    = new PDFDocument({ size: 'A5', margin: 40 });
      const stream = fs.createWriteStream(rutaPdf);

      doc.pipe(stream);

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
      doc.fontSize(10)
         .text(`Fecha: ${new Date().toLocaleDateString('es-PE', {
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

      stream.on('finish', resolve);
      stream.on('error',  reject);
    });
  }
}

module.exports = { PDFKitGenerator };
