const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const { DomainError } = require('../../../../../shared/domain/errors');

const STORAGE_PATH = process.env.STORAGE_PATH_RECETAS || './storage/recetas-contingencia';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost';

class RecetaPDFGenerator {
  async generar(receta) {
    if (!fs.existsSync(STORAGE_PATH)) {
      fs.mkdirSync(STORAGE_PATH, { recursive: true });
    }

    const nombreArchivo = `${receta.id}.pdf`;
    const rutaPdf        = path.join(STORAGE_PATH, nombreArchivo);
    const urlDescarga     = `${APP_BASE_URL}/api/v2/prescripciones/contingencia/${receta.id}/pdf`;

    try {
      await this._generarPDF(receta, rutaPdf);
      return { rutaPdf, urlDescarga };
    } catch (err) {
      if (fs.existsSync(rutaPdf)) {
        fs.unlinkSync(rutaPdf);
      }
      throw new DomainError('ERROR_GENERACION_PDF', 500,
        `No se pudo generar el PDF de la receta de contingencia: ${err.message}`);
    }
  }

  _generarPDF(receta, rutaPdf) {
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
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Aviso de contingencia ────────────────────────────────────────────────
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#B45309')
         .text('⚠ RECETA DE CONTINGENCIA', { align: 'center' });
      doc.fontSize(8).font('Helvetica').fillColor('#B45309')
         .text('Generada porque el sistema de farmacia no estaba disponible al momento de la emisión. ' +
               'Preséntela en cualquier farmacia junto con su documento de identidad.', { align: 'center' });
      doc.fillColor('black');
      doc.moveDown(0.8);

      // ── Título ────────────────────────────────────────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold')
         .text('RECETA MÉDICA', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
         .text(`Nro: ${receta.id}`, { align: 'center' });
      doc.fontSize(9)
         .text(`Fecha: ${new Date().toLocaleDateString('es-PE', {
           day: '2-digit', month: '2-digit', year: 'numeric',
         })}`, { align: 'center' });
      doc.moveDown(0.8);

      // ── Datos del paciente ────────────────────────────────────────────────────
      doc.fontSize(10).font('Helvetica-Bold').text('DATOS DEL PACIENTE');
      doc.font('Helvetica');
      if (receta.nombrePaciente) {
        doc.text(`Paciente: ${receta.nombrePaciente}`);
      }
      doc.text(`ID Paciente: ${receta.idPaciente}`);
      doc.moveDown(0.8);

      // ── Medicamento ───────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').text('MEDICAMENTO PRESCRITO');
      doc.font('Helvetica');
      doc.text(`Medicamento: ${receta.medicamento || 'No especificado'}`);
      if (receta.dosis)    doc.text(`Dosis: ${receta.dosis}`);
      if (receta.cantidad) doc.text(`Cantidad: ${receta.cantidad}`);
      doc.moveDown(1.2);

      // ── Pie de página ─────────────────────────────────────────────────────────
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8)
         .text('MediCitas — Documento válido como receta médica.', { align: 'center' })
         .text('Ante cualquier duda, contacte a su médico tratante.', { align: 'center' });

      doc.end();

      stream.on('finish', resolve);
      stream.on('error',  reject);
    });
  }
}

module.exports = { RecetaPDFGenerator };
