const PDFDocument = require('pdfkit');
const { DomainError } = require('../../../../../shared/domain/errors');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost';

// Genera la receta en PDF SIN tocar disco (regla del proyecto: todo en memoria
// para no crear cuellos de I/O bajo concurrencia). La ruta de descarga REGENERA
// el PDF al vuelo desde el registro de la BD; no se persiste el archivo.
class RecetaPDFGenerator {
  urlDescarga(receta) {
    return `${APP_BASE_URL}/api/v2/prescripciones/contingencia/${receta.id}/pdf`;
  }

  // Devuelve el PDF como Buffer en memoria (lo usa la ruta de descarga).
  async generarBuffer(receta) {
    try {
      return await this._construirBuffer(receta);
    } catch (err) {
      throw new DomainError('ERROR_GENERACION_PDF', 500,
        `No se pudo generar el PDF de la receta: ${err.message}`);
    }
  }

  // En la emisión: valida que el PDF se puede generar (descarta el buffer) y
  // devuelve solo la URL de descarga. No escribe nada a disco.
  async generar(receta) {
    await this.generarBuffer(receta);
    return { urlDescarga: this.urlDescarga(receta) };
  }

  _construirBuffer(receta) {
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
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Aviso de contingencia (solo si la farmacia estaba caída) ──────────────
      if (receta.esContingencia) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#B45309')
           .text('⚠ RECETA DE CONTINGENCIA', { align: 'center' });
        doc.fontSize(8).font('Helvetica').fillColor('#B45309')
           .text('Generada porque el sistema de farmacia no estaba disponible al momento de la emisión. ' +
                 'Preséntela en cualquier farmacia junto con su documento de identidad.', { align: 'center' });
        doc.fillColor('black');
        doc.moveDown(0.8);
      }

      // ── Título ────────────────────────────────────────────────────────────────
      doc.fontSize(14).font('Helvetica-Bold')
         .text('RECETA MÉDICA', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
         .text(`Nro: ${receta.id}`, { align: 'center' });
      // En la descarga el PDF se regenera al vuelo: se usa la fecha de emisión
      // persistida (created_at) para que el documento no cambie entre descargas.
      const fechaEmision = receta.fechaGeneracion ? new Date(receta.fechaGeneracion) : new Date();
      doc.fontSize(9)
         .text(`Fecha: ${fechaEmision.toLocaleDateString('es-PE', {
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
      if (receta.idEncuentroClinico) {
        // Mismo ID que agrupa esta receta en la cola de despacho de farmacia
        // — permite cruzar manualmente el PDF contra esa pantalla.
        doc.text(`ID Encuentro: ${receta.idEncuentroClinico}`);
      }
      doc.moveDown(0.8);

      // ── Medicamento ───────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').text('MEDICAMENTO PRESCRITO');
      doc.font('Helvetica');
      doc.text(`Medicamento: ${receta.medicamento || 'No especificado'}`);
      if (receta.dosis)    doc.text(`Dosis: ${receta.dosis}`);
      if (receta.cantidad) doc.text(`Cantidad: ${receta.cantidad}`);
      if (receta.referenciaFarmacia) doc.text(`Referencia de farmacia: ${receta.referenciaFarmacia}`);
      doc.moveDown(1.2);

      // ── Pie de página ─────────────────────────────────────────────────────────
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8)
         .text('MediCitas — Documento válido como receta médica.', { align: 'center' })
         .text('Ante cualquier duda, contacte a su médico tratante.', { align: 'center' });

      doc.end();
    });
  }
}

module.exports = { RecetaPDFGenerator };
