import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnkalPdfLayout, type PdfPageLayout } from './importEngine';

test('parseAnkalPdfLayout extracts ANKAL header, personnel list, Section B X-columns, continuation pages, and sparse scans', () => {
  const page1: PdfPageLayout = {
    pageNumber: 1,
    text: '022/SPS/AKL/X/2026 Pelanggan Nama Pekerjaan',
    items: [
      { x: 42, y: 760, str: 'No. Surat Pengantar' },
      { x: 185, y: 760, str: ': 022/SPS/AKL/X/2026' },
      { x: 42, y: 742, str: 'Pelanggan' },
      { x: 185, y: 742, str: ': PT. Indonesia Weda Bay' },
      { x: 185, y: 730, str: 'Industrial Park (IWIP)' },
      { x: 42, y: 712, str: 'Alamat' },
      { x: 185, y: 712, str: ': Halmahera Tengah' },
      { x: 42, y: 694, str: 'Nama Pekerjaan' },
      { x: 185, y: 694, str: ': Pemantauan Emisi Q4 (022/LHP/X/2026)' },
      { x: 42, y: 676, str: 'Tanggal Pengambilan' },
      { x: 185, y: 676, str: ': 12 - 15 Oktober 2026' },
      { x: 42, y: 658, str: 'Lokasi' },
      { x: 185, y: 658, str: ': Kawasan Industri IWIP' },
      { x: 42, y: 640, str: 'Nama Pelanggan' },
      { x: 185, y: 640, str: ': Bapak Dhasyriel' },
      { x: 42, y: 622, str: 'No. PIC Pelanggan' },
      { x: 185, y: 622, str: ': 08123456789' },
      { x: 42, y: 604, str: 'Nama Petugas' },
      { x: 185, y: 604, str: ': Romi Dasilva' },
      { x: 185, y: 590, str: 'Kefien Winerungan' },
      { x: 42, y: 560, str: 'A. JADWAL KEGIATAN' },
      { x: 140, y: 530, str: 'Pengambilan Contoh Uji Emisi & Ambien' },
      { x: 42, y: 500, str: 'B. INFORMASI CONTOH UJI' },
      { x: 42, y: 480, str: 'No' },
      { x: 75, y: 480, str: 'Tanggal' },
      { x: 132, y: 480, str: 'Matriks' },
      { x: 190, y: 480, str: 'Jumlah' },
      { x: 224, y: 480, str: 'Titik Lokasi' },
      { x: 300, y: 480, str: 'Parameter' },
      { x: 472, y: 480, str: 'Regulasi' },
      // Row 1
      { x: 46, y: 440, str: '1' },
      { x: 75, y: 440, str: '12 Okt 2026' },
      { x: 132, y: 440, str: 'Emission Air' },
      { x: 195, y: 440, str: '1' },
      { x: 224, y: 440, str: 'Incinerator Domestik' },
      { x: 298, y: 440, str: 'Total Partikulat, SO2, NOx' },
      { x: 475, y: 440, str: 'Permen LHK No 70 Tahun 2016' },
      { x: 42, y: 120, str: 'C. Catatan / Keterangan' },
    ],
  };

  const page2Continuation: PdfPageLayout = {
    pageNumber: 2,
    text: '(3 Januari 2023) Emission Air Partikulat',
    items: [
      { x: 420, y: 805, str: '(3 Januari 2023)' },
      { x: 46, y: 740, str: '2' },
      { x: 75, y: 740, str: '13 Okt 2026' },
      { x: 132, y: 740, str: 'Ambient Air' },
      { x: 195, y: 740, str: '2' },
      { x: 224, y: 740, str: 'Area Upwind' },
      { x: 298, y: 740, str: 'PM10, PM2.5, SO2' },
      { x: 475, y: 740, str: 'PP No 22 Tahun 2021' },
      { x: 42, y: 120, str: 'C. Catatan / Keterangan' },
    ],
  };

  const page3Scanned: PdfPageLayout = {
    pageNumber: 3,
    text: '012/SPS/AKL/XI/2026',
    items: [{ x: 185, y: 760, str: '012/SPS/AKL/XI/2026' }],
  };

  const result = parseAnkalPdfLayout([page1, page2Continuation, page3Scanned]);

  assert.equal(result.records.length, 2);
  assert.deepEqual(result.scannedPages, [3]);

  const rec1 = result.records[0];
  assert.equal(rec1.document_number, '022/SPS/AKL/X/2026');
  assert.equal(rec1.customer_name, 'PT. Indonesia Weda Bay Industrial Park (IWIP)');
  assert.equal(rec1.lhp_number, '022/LHP/X/2026');
  assert.deepEqual(rec1.sampling_personnel, ['Romi Dasilva', 'Kefien Winerungan']);
  assert.equal(rec1.matrices.length, 2);
  assert.equal(rec1.matrices[0].sampling_points, 'Incinerator Domestik');
  assert.equal(rec1.matrices[0].parameters, 'Total Partikulat, SO2, NOx');
  assert.equal(rec1.matrices[1].matrix_name, 'Ambient Air');
  assert.equal(rec1.matrices[1].sampling_point_count, 2);
  assert.ok(!rec1.matrices[1].applicable_regulation.includes('3 Januari 2023'));

  const rec2 = result.records[1];
  assert.equal(rec2.document_number, '012/SPS/AKL/XI/2026');
  assert.equal(rec2.source_page, 3);
  assert.ok(rec2.missing_fields.includes('customer_name'));
});
