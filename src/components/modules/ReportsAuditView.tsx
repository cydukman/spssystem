import React, { useEffect, useState } from 'react';
import { Download, BarChart3, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { SkeletonTable, formatDateTimeId } from '../ui/Common';

interface ReportsData {
  totalRequests: number;
  totalSps: number;
  statusBreakdown: Record<string, number>;
  personnelStats: Array<{
    id: string;
    code: string;
    fullName: string;
    category: string;
    confirmedAssignments: number;
  }>;
  vehicleStats: Array<{
    id: string;
    vehicleCode: string;
    registrationNumber: string;
    model: string;
    operationalStatus: string;
    reservationCount: number;
  }>;
}

interface AuditLogRow {
  id: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityNumber: string;
  notes: string;
  createdAt: string;
}

export function ReportsAuditView({ mode }: { mode: 'reports' | 'audit' }) {
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (mode === 'reports') {
          const data = await apiFetch<ReportsData>('/api/reports');
          setReports(data);
        } else {
          const rows = await apiFetch<AuditLogRow[]>('/api/audit-logs');
          setLogs(rows);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Gagal memuat data.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [mode]);

  const exportCsv = () => {
    if (!reports) return;
    const lines = [
      'Kode,Nama Personel,Kategori,Penugasan Terkonfirmasi',
      ...reports.personnelStats.map(
        (p) => `"${p.code}","${p.fullName}","${p.category}",${p.confirmedAssignments}`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Laporan_Utilisasi_Personel_ANKAL.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (loading) return <SkeletonTable rows={6} />;

  if (error) {
    return <div className="p-4 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>;
  }

  if (mode === 'audit') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-6 h-6 text-[#25AC43]" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Log Audit Sistem</h1>
            <p className="text-sm text-slate-500">
              Catatan jejak audit tak terhapus untuk setiap persetujuan, penugasan, penggantian personel, dan penerbitan/pengarsipan SPS.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Waktu</th>
                  <th className="px-4 py-3 font-medium">Aktor &amp; Peran</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                  <th className="px-4 py-3 font-medium">Entitas &amp; Referensi</th>
                  <th className="px-4 py-3 font-medium">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap text-slate-500">
                      {formatDateTimeId(l.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{l.actorName}</div>
                      <div className="text-[11px] text-slate-500">{l.actorRole}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-800">{l.action}</td>
                    <td className="px-4 py-3">
                      <span className="text-slate-600">{l.entityType}</span>
                      {l.entityNumber && (
                        <span className="ml-1.5 font-mono font-semibold text-slate-900">{l.entityNumber}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{l.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-6 h-6 text-[#25AC43]" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Laporan &amp; Analitik Operasional</h1>
            <p className="text-sm text-slate-500">
              Distribusi status permintaan, beban kerja personel internal vs freelance, dan utilisasi armada kendaraan.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Ekspor Utilisasi Personel (CSV)</span>
        </button>
      </div>

      {reports && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Total Permintaan</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{reports.totalRequests}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Total Dokumen SPS</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{reports.totalSps}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Personel Terdaftar</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{reports.personnelStats.length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500">Armada Kendaraan</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{reports.vehicleStats.length}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Personnel Utilization */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Utilisasi Penugasan Personel</h2>
              </div>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Personel</th>
                    <th className="px-4 py-2.5 font-medium">Kategori</th>
                    <th className="px-4 py-2.5 font-medium text-right">Tugas Terkonfirmasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.personnelStats.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {p.code} — {p.fullName}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {p.category === 'INTERNAL' ? 'Internal' : 'Freelance'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {p.confirmedAssignments}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Vehicle Utilization */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Utilisasi Armada Kendaraan</h2>
              </div>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Kendaraan</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Total Reservasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.vehicleStats.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900 tabular-nums">{v.registrationNumber}</div>
                        <div className="text-slate-500">{v.model}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{v.operationalStatus}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{v.reservationCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
