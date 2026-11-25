import PDFDocument from 'pdfkit';
import type { SpsMatrixRow, SpsScheduleRow } from '../db/schema.ts';

export interface SpsPdfPayload {
  spsNumber: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  jobName: string;
  lhpNumber?: string | null;
  contractNumber?: string | null;
  samplingDateLabel: string;
  samplingLocation: string;
  customerPic: string;
  picPhone: string;
  assignedPersonnelNames: string[];
  scheduleRows: SpsScheduleRow[];
  matrixRows: SpsMatrixRow[];
  notes?: string | null;
  preparedByName?: string | null;
  revisionNumber: number;
  lifecycleStatus: string;
}

export async function generateSpsPdfBuffer(docData: SpsPdfPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 44, left: 36, right: 36 },
      bufferPages: true,
      info: {
        Title: `SPS ${docData.spsNumber} - ${docData.customerName}`,
        Author: 'PT Analitika Kalibrasi Laboratorium (ANKAL)',
        Subject: 'Surat Pengantar Pengambilan Contoh Uji (ANKAL-FO-7.1-01)',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = doc.page.width;
    const leftMargin = 36;
    const contentWidth = pageWidth - 72; // 595.28 - 72 = 523.28

    const drawHeader = () => {
      // Brand Wordmark ANKAL
      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#25AC43')
        .text('ANKAL', leftMargin, 34, { continued: false });

      // Title
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#0F172A')
        .text('SURAT PENGANTAR PENGAMBILAN CONTOH UJI', leftMargin + 85, 36, {
          width: 310,
          align: 'center',
        });

      // Form Code
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#334155')
        .text('ANKAL-FO-7.1-01\n(3 Januari 2023)', leftMargin + 400, 34, {
          width: contentWidth - 400,
          align: 'right',
        });

      doc
        .moveTo(leftMargin, 64)
        .lineTo(leftMargin + contentWidth, 64)
        .strokeColor('#CBD5E1')
        .lineWidth(0.75)
        .stroke();
    };

    drawHeader();
    let y = 74;

    const metaRows: Array<[string, string]> = [
      ['No. Surat Pengantar Pengambil Contoh Uji', docData.spsNumber + (docData.revisionNumber > 1 ? ` (Rev. ${docData.revisionNumber})` : '')],
      ['Pelanggan', docData.customerName],
      ['Alamat', docData.customerAddress || '-'],
      ['Telp. / Fax / No. Kontrak', `${docData.customerPhone || '-'} / ${docData.contractNumber || '-'}`],
      ['Nama Pekerjaan (No. LHP)', `${docData.jobName}${docData.lhpNumber ? ` (${docData.lhpNumber})` : ''}`],
      ['Tanggal Pengambilan Contoh Uji', docData.samplingDateLabel],
      ['Lokasi', docData.samplingLocation],
      ['Nama Pelanggan (PIC)', docData.customerPic || '-'],
      ['No. PIC Pelanggan', docData.picPhone || '-'],
    ];

    doc.fontSize(8.5);
    for (const [label, value] of metaRows) {
      doc.font('Helvetica').fillColor('#334155').text(label, leftMargin, y, { width: 175 });
      const valHeight = doc.heightOfString(`: ${value}`, { width: contentWidth - 180 });
      doc.font('Helvetica-Bold').fillColor('#0F172A').text(`: ${value}`, leftMargin + 178, y, {
        width: contentWidth - 180,
      });
      y += Math.max(13, valHeight + 3);
    }

    const personnelList =
      docData.assignedPersonnelNames.length > 0
        ? docData.assignedPersonnelNames
        : ['-'];

    doc.font('Helvetica').fillColor('#334155').text('Nama Petugas Pengambil Contoh Uji', leftMargin, y, {
      width: 175,
    });
    for (let i = 0; i < personnelList.length; i++) {
      doc.font('Helvetica').fillColor('#0F172A').text(`: ${personnelList[i]}`, leftMargin + 178, y, {
        width: contentWidth - 180,
      });
      y += 12;
    }

    y += 8;

    // SECTION A: JADWAL KEGIATAN
    const ensurePageSpace = (neededHeight: number) => {
      if (y + neededHeight > doc.page.height - 60) {
        doc.addPage();
        drawHeader();
        y = 76;
      }
    };

    ensurePageSpace(55);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#0F172A')
      .text('A.   JADWAL KEGIATAN PENGAMBILAN CONTOH UJI', leftMargin, y);
    y += 14;

    const colA = [130, 230, contentWidth - 360];
    doc.rect(leftMargin, y, contentWidth, 20).fillAndStroke('#E2E8F0', '#334155');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8);
    doc.text('Hari / Tanggal', leftMargin + 4, y + 6, { width: colA[0] - 8, align: 'center' });
    doc.text('Kegiatan', leftMargin + colA[0] + 4, y + 6, { width: colA[1] - 8, align: 'center' });
    doc.text('Catatan', leftMargin + colA[0] + colA[1] + 4, y + 6, { width: colA[2] - 8, align: 'center' });
    doc
      .moveTo(leftMargin + colA[0], y)
      .lineTo(leftMargin + colA[0], y + 20)
      .moveTo(leftMargin + colA[0] + colA[1], y)
      .lineTo(leftMargin + colA[0] + colA[1], y + 20)
      .strokeColor('#334155')
      .stroke();
    y += 20;

    const scheduleRows =
      docData.scheduleRows.length > 0
        ? docData.scheduleRows
        : [{ dateLabel: docData.samplingDateLabel, activity: docData.jobName, notes: '-' }];

    doc.font('Helvetica').fontSize(8);
    for (const row of scheduleRows) {
      const h1 = doc.heightOfString(row.dateLabel, { width: colA[0] - 8 });
      const h2 = doc.heightOfString(row.activity, { width: colA[1] - 8 });
      const h3 = doc.heightOfString(row.notes || '-', { width: colA[2] - 8 });
      const rowH = Math.max(20, h1 + 10, h2 + 10, h3 + 10);
      ensurePageSpace(rowH);

      doc.rect(leftMargin, y, contentWidth, rowH).strokeColor('#334155').stroke();
      doc
        .moveTo(leftMargin + colA[0], y)
        .lineTo(leftMargin + colA[0], y + rowH)
        .moveTo(leftMargin + colA[0] + colA[1], y)
        .lineTo(leftMargin + colA[0] + colA[1], y + rowH)
        .stroke();

      doc.fillColor('#0F172A');
      doc.text(row.dateLabel, leftMargin + 4, y + 5, { width: colA[0] - 8, align: 'center' });
      doc.text(row.activity, leftMargin + colA[0] + 4, y + 5, { width: colA[1] - 8, align: 'center' });
      doc.text(row.notes || '-', leftMargin + colA[0] + colA[1] + 4, y + 5, {
        width: colA[2] - 8,
        align: 'center',
      });
      y += rowH;
    }

    y += 12;

    // SECTION B: INFORMASI CONTOH UJI
    ensurePageSpace(55);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#0F172A')
      .text('B.   INFORMASI CONTOH UJI', leftMargin, y);
    y += 14;

    const colB = [24, 72, 74, 34, 88, 138, contentWidth - 430]; // sum = contentWidth
    const drawTableBHeader = () => {
      doc.rect(leftMargin, y, contentWidth, 22).fillAndStroke('#E2E8F0', '#334155');
      const headers = ['No', 'Tanggal', 'Matriks', 'Jml', 'Titik Lokasi', 'Parameter', 'Regulasi'];
      let cx = leftMargin;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0F172A');
      for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], cx + 3, y + 7, { width: colB[i] - 6, align: 'center' });
        if (i > 0) {
          doc.moveTo(cx, y).lineTo(cx, y + 22).strokeColor('#334155').stroke();
        }
        cx += colB[i];
      }
      y += 22;
    };

    drawTableBHeader();

    const matrixRows = docData.matrixRows;
    for (let idx = 0; idx < matrixRows.length; idx++) {
      const m = matrixRows[idx];
      const paramText =
        m.subcontractedParameters && m.subcontractedParameters.trim().length > 0
          ? `${m.parameters}\nParameter Subkontrak: ${m.subcontractedParameters}`
          : m.parameters;

      doc.font('Helvetica').fontSize(7.5);
      const heights = [
        doc.heightOfString(String(m.no || idx + 1), { width: colB[0] - 6 }),
        doc.heightOfString(m.dateLabel || docData.samplingDateLabel, { width: colB[1] - 6 }),
        doc.heightOfString(m.matrixName, { width: colB[2] - 6 }),
        doc.heightOfString(String(m.pointCount), { width: colB[3] - 6 }),
        doc.heightOfString(m.pointLocations || 'Sesuai ketentuan pelanggan', { width: colB[4] - 6 }),
        doc.heightOfString(paramText || '-', { width: colB[5] - 6 }),
        doc.heightOfString(m.regulation || '-', { width: colB[6] - 6 }),
      ];
      const rowH = Math.max(24, ...heights.map((h) => h + 10));

      if (y + rowH > doc.page.height - 60) {
        doc.addPage();
        drawHeader();
        y = 76;
        drawTableBHeader();
      }

      doc.rect(leftMargin, y, contentWidth, rowH).strokeColor('#334155').stroke();
      let cx = leftMargin;
      for (let i = 1; i < colB.length; i++) {
        cx += colB[i - 1];
        doc.moveTo(cx, y).lineTo(cx, y + rowH).strokeColor('#334155').stroke();
      }

      const cells = [
        String(m.no || idx + 1),
        m.dateLabel || docData.samplingDateLabel,
        m.matrixName,
        String(m.pointCount),
        m.pointLocations || 'Sesuai ketentuan pelanggan',
        paramText || '-',
        m.regulation || '-',
      ];
      cx = leftMargin;
      doc.fillColor('#0F172A').font('Helvetica').fontSize(7.5);
      for (let i = 0; i < cells.length; i++) {
        doc.text(cells[i], cx + 3, y + 5, {
          width: colB[i] - 6,
          align: i === 5 ? 'left' : 'center',
        });
        cx += colB[i];
      }
      y += rowH;
    }

    y += 12;

    // SECTION C: CATATAN / KETERANGAN
    ensurePageSpace(130);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#0F172A')
      .text('C.   Catatan / Keterangan', leftMargin, y);
    y += 12;

    const noteContent = docData.notes?.trim() || '-';
    const noteH = Math.max(32, doc.heightOfString(noteContent, { width: contentWidth - 12 }) + 12);
    doc.rect(leftMargin, y, contentWidth, noteH).strokeColor('#334155').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#0F172A').text(noteContent, leftMargin + 6, y + 6, {
      width: contentWidth - 12,
    });
    y += noteH + 22;

    // SIGNATURE SECTION (Designated areas only, no fake signatures)
    ensurePageSpace(90);
    const sigWidth = contentWidth / 3;
    doc.font('Helvetica').fontSize(8.5).fillColor('#0F172A');
    doc.text('Dibuat Oleh', leftMargin, y, { width: sigWidth, align: 'center' });
    doc.text('Dilaksanakan Oleh', leftMargin + sigWidth, y, { width: sigWidth, align: 'center' });
    doc.text('Disetujui Oleh', leftMargin + sigWidth * 2, y, { width: sigWidth, align: 'center' });

    y += 52;
    doc
      .moveTo(leftMargin + 22, y)
      .lineTo(leftMargin + sigWidth - 22, y)
      .moveTo(leftMargin + sigWidth + 22, y)
      .lineTo(leftMargin + sigWidth * 2 - 22, y)
      .moveTo(leftMargin + sigWidth * 2 + 22, y)
      .lineTo(leftMargin + contentWidth - 22, y)
      .strokeColor('#334155')
      .stroke();

    y += 4;
    doc.font('Helvetica').fontSize(8).fillColor('#334155');
    doc.text(docData.preparedByName || 'Spv. Sampling', leftMargin, y, {
      width: sigWidth,
      align: 'center',
    });
    doc.text('Petugas Pengambil Contoh Uji', leftMargin + sigWidth, y, {
      width: sigWidth,
      align: 'center',
    });
    doc.text('Pelanggan', leftMargin + sigWidth * 2, y, {
      width: sigWidth,
      align: 'center',
    });

    // Consistent page numbering
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(
          `PT Analitika Kalibrasi Laboratorium — ${docData.spsNumber} | Halaman ${i + 1} dari ${range.count}`,
          leftMargin,
          doc.page.height - 28,
          { width: contentWidth, align: 'center' }
        );
    }

    doc.end();
  });
}
