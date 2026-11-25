import React from 'react';
import { Download, Printer } from 'lucide-react';
import type { SpsDocument } from '../types/ankal';
import { openAuthenticatedPdf } from '../lib/api';

export function SpsPrintPreview({ doc }: { doc: SpsDocument }) {
  const scheduleRows =
    doc.scheduleRows && doc.scheduleRows.length > 0
      ? doc.scheduleRows
      : [
          {
            dateLabel: doc.samplingDateLabel,
            activity: doc.jobName,
            notes: '-',
          },
        ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-md px-4 py-3 no-print">
        <div className="text-xs text-slate-600 tabular-nums">
          Referensi Formulir: <span className="font-semibold text-slate-900">ANKAL-FO-7.1-01</span>
          <span className="mx-2" aria-hidden="true">·</span>
          Revisi: <span className="font-semibold text-slate-900">Rev. {doc.revisionNumber}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Cetak / Print A4</span>
          </button>
          <button
            type="button"
            onClick={() => openAuthenticatedPdf(`/api/sps/${doc.id}/pdf`, true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] rounded hover:bg-[#1e8e36] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh PDF Resmi</span>
          </button>
        </div>
      </div>

      {/* A4 Document Sheet */}
      <div className="bg-white border border-slate-300 shadow-sm mx-auto p-8 text-[11px] text-slate-900 leading-relaxed max-w-[794px]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-300 pb-3 mb-4">
          <div className="text-2xl font-extrabold tracking-tight text-[#25AC43]">
            ANKAL
          </div>
          <div className="text-center font-bold text-sm tracking-wide text-slate-900 pt-1">
            SURAT PENGANTAR PENGAMBILAN CONTOH UJI
          </div>
          <div className="text-right text-[10px] text-slate-600 leading-tight">
            <div>ANKAL-FO-7.1-01</div>
            <div>(3 Januari 2023)</div>
          </div>
        </div>

        {/* Metadata Table */}
        <table className="w-full text-[11px] mb-5">
          <tbody>
            <tr>
              <td className="w-56 py-0.5 text-slate-700 align-top">No. Surat Pengantar Pengambil Contoh Uji</td>
              <td className="py-0.5 font-semibold text-slate-900 tabular-nums">: {doc.spsNumber}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Pelanggan</td>
              <td className="py-0.5 font-semibold text-slate-900">: {doc.customerName}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Alamat</td>
              <td className="py-0.5">: {doc.customerAddress || '-'}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Telp. / Fax / No. Kontrak</td>
              <td className="py-0.5 tabular-nums">: {doc.customerPhone || '-'} / {doc.contractNumber || '-'}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Nama Pekerjaan (No. LHP)</td>
              <td className="py-0.5">: {doc.jobName}{doc.lhpNumber ? ` (${doc.lhpNumber})` : ''}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Tanggal Pengambilan Contoh Uji</td>
              <td className="py-0.5 font-medium tabular-nums">: {doc.samplingDateLabel}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Lokasi</td>
              <td className="py-0.5">: {doc.samplingLocation}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Nama Pelanggan</td>
              <td className="py-0.5">: {doc.customerPic || '-'}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">No. PIC Pelanggan</td>
              <td className="py-0.5 tabular-nums">: {doc.picPhone || '-'}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-slate-700 align-top">Nama Petugas Pengambil Contoh Uji</td>
              <td className="py-0.5">
                {doc.assignedPersonnelNames && doc.assignedPersonnelNames.length > 0 ? (
                  doc.assignedPersonnelNames.map((name, idx) => (
                    <div key={idx}>: {name}</div>
                  ))
                ) : (
                  <div>: -</div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Section A */}
        <div className="mb-4">
          <div className="font-bold text-[11px] mb-1.5">
            A. &nbsp;&nbsp; JADWAL KEGIATAN PENGAMBILAN CONTOH UJI
          </div>
          <table className="w-full border-collapse border border-slate-700 text-[10.5px]">
            <thead>
              <tr className="bg-slate-200/80">
                <th className="border border-slate-700 px-2 py-1.5 text-center w-36">Hari / Tanggal</th>
                <th className="border border-slate-700 px-2 py-1.5 text-center">Kegiatan</th>
                <th className="border border-slate-700 px-2 py-1.5 text-center w-44">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.map((row, i) => (
                <tr key={i}>
                  <td className="border border-slate-700 px-2 py-1.5 text-center tabular-nums">{row.dateLabel}</td>
                  <td className="border border-slate-700 px-2 py-1.5 text-center">{row.activity}</td>
                  <td className="border border-slate-700 px-2 py-1.5 text-center">{row.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Section B */}
        <div className="mb-4">
          <div className="font-bold text-[11px] mb-1.5">
            B. &nbsp;&nbsp; INFORMASI CONTOH UJI
          </div>
          <table className="w-full border-collapse border border-slate-700 text-[10px]">
            <thead>
              <tr className="bg-slate-200/80">
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-8">No</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-24">Tanggal</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-24">Matriks</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-12">Jumlah</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-28">Titik Lokasi</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center">Parameter</th>
                <th className="border border-slate-700 px-1.5 py-1.5 text-center w-32">Regulasi</th>
              </tr>
            </thead>
            <tbody>
              {(doc.matrixRows || []).map((m, idx) => (
                <tr key={idx}>
                  <td className="border border-slate-700 px-1.5 py-2 text-center tabular-nums">{m.no || idx + 1}</td>
                  <td className="border border-slate-700 px-1.5 py-2 text-center tabular-nums">{m.dateLabel || doc.samplingDateLabel}</td>
                  <td className="border border-slate-700 px-1.5 py-2 text-center font-medium">{m.matrixName}</td>
                  <td className="border border-slate-700 px-1.5 py-2 text-center tabular-nums">{m.pointCount}</td>
                  <td className="border border-slate-700 px-1.5 py-2 text-center">{m.pointLocations}</td>
                  <td className="border border-slate-700 px-2 py-2">
                    <div>{m.parameters}</div>
                    {m.subcontractedParameters && (
                      <div className="mt-1 font-medium text-slate-800">
                        Parameter Subkontrak: {m.subcontractedParameters}
                      </div>
                    )}
                  </td>
                  <td className="border border-slate-700 px-1.5 py-2 text-center">{m.regulation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Section C */}
        <div className="mb-8">
          <div className="font-bold text-[11px] mb-1">C. &nbsp;&nbsp; Catatan / Keterangan</div>
          <div className="border border-slate-700 px-3 py-2 min-h-[42px] text-[10.5px]">
            {doc.notes || '-'}
          </div>
        </div>

        {/* Signatures (Designated authorized areas, no fake signatures) */}
        <div className="grid grid-cols-3 gap-6 text-center pt-2">
          <div>
            <div className="mb-14">Dibuat Oleh</div>
            <div className="border-t border-slate-700 mx-4 pt-1 font-medium">
              {doc.preparedByName || 'Spv. Sampling'}
            </div>
            <div className="text-[10px] text-slate-600">Spv. Sampling</div>
          </div>
          <div>
            <div className="mb-14">Dilaksanakan Oleh</div>
            <div className="border-t border-slate-700 mx-4 pt-1 font-medium">
              &nbsp;
            </div>
            <div className="text-[10px] text-slate-600">Petugas Pengambil Contoh Uji</div>
          </div>
          <div>
            <div className="mb-14">Disetujui Oleh</div>
            <div className="border-t border-slate-700 mx-4 pt-1 font-medium">
              &nbsp;
            </div>
            <div className="text-[10px] text-slate-600">Pelanggan</div>
          </div>
        </div>
      </div>
    </div>
  );
}
