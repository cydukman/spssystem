import React, { useEffect, useMemo, useState } from 'react';
import { Search, Eye, Download, RotateCcw, History } from 'lucide-react';
import { apiFetch, openAuthenticatedPdf } from '../../lib/api';
import type { AppUser, SpsDocument } from '../../types/ankal';
import { EmptyState, ModalDialog, SkeletonTable, StatusTag, formatDateId } from '../ui/Common';
import { SpsPrintPreview } from '../SpsPrintPreview';

interface ArchiveRow {
  id: string;
  spsDocumentId: string;
  spsNumber: string;
  customerName: string;
  jobName: string;
  samplingYear: number;
  matricesSummary: string;
  personnelSummary: string;
  archivedByName: string;
  archivalReason: string;
  archivedAt: string;
  spsDocument: SpsDocument | null;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    changeReason: string;
    revisedByName: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    actorName: string;
    createdAt: string;
  }>;
}

export function ArchiveView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('ALL');

  const [previewDoc, setPreviewDoc] = useState<SpsDocument | null>(null);
  const [historyArchive, setHistoryArchive] = useState<ArchiveRow | null>(null);

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<ArchiveRow[]>('/api/archives');
      setArchives(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat arsip dokumen.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const years = useMemo(
    () => Array.from(new Set(archives.map((a) => a.samplingYear))).sort((a, b) => b - a),
    [archives]
  );

  const filtered = archives.filter((a) => {
    if (yearFilter !== 'ALL' && String(a.samplingYear) !== yearFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        a.spsNumber.toLowerCase().includes(q) ||
        a.customerName.toLowerCase().includes(q) ||
        a.jobName.toLowerCase().includes(q) ||
        a.matricesSummary.toLowerCase().includes(q) ||
        a.personnelSummary.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleRestore = async (spsId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/archives/${spsId}/restore`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Dipulihkan kembali ke daftar SPS aktif' }),
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memulihkan dokumen.');
    }
  };

  if (loading) return <SkeletonTable rows={6} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Arsip Dokumen SPS</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Repositori permanen SPS historis &amp; selesai pelaksanaan dengan jejak revisi lengkap. Dokumen arsip tidak pernah dihapus permanen.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor SPS, pelanggan, pekerjaan, matriks, atau personel..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <select
          aria-label="Filter tahun arsip"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="ALL">Semua Tahun</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              Tahun {y}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Arsip dokumen kosong"
          description="Dokumen SPS yang telah dikonfirmasi pengarsipannya atau hasil impor historis akan tersimpan di sini."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">No. SPS &amp; Tahun</th>
                  <th className="px-4 py-3 font-medium">Pelanggan &amp; Pekerjaan</th>
                  <th className="px-4 py-3 font-medium">Matriks &amp; Personel</th>
                  <th className="px-4 py-3 font-medium">Diarsipkan Oleh</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="font-mono text-xs font-bold text-slate-900 tabular-nums">{a.spsNumber}</div>
                      <div className="text-xs text-slate-500 tabular-nums mt-0.5">{a.samplingYear}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{a.customerName}</div>
                      <div className="text-xs text-slate-600">{a.jobName}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600">
                      <div>Matriks: {a.matricesSummary || '-'}</div>
                      <div className="text-slate-500 mt-0.5">Petugas: {a.personnelSummary || '-'}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600">
                      <div className="font-medium text-slate-800">{a.archivedByName}</div>
                      <div className="text-slate-500 tabular-nums">{formatDateId(a.archivedAt)}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {a.spsDocument && (
                          <>
                            <button
                              type="button"
                              onClick={() => setPreviewDoc(a.spsDocument)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Pratinjau</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openAuthenticatedPdf(`/api/sps/${a.spsDocumentId}/pdf`, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>PDF</span>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setHistoryArchive(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                          <span>Riwayat</span>
                        </button>
                        {canManage && !a.spsDocument?.isImmutable && (
                          <button
                            type="button"
                            onClick={() => handleRestore(a.spsDocumentId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Pulihkan</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* A4 Preview Modal */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc ? `Arsip SPS — ${previewDoc.spsNumber}` : ''}
        maxWidth="max-w-5xl"
      >
        {previewDoc && <SpsPrintPreview doc={previewDoc} />}
      </ModalDialog>

      {/* History Modal */}
      <ModalDialog
        open={Boolean(historyArchive)}
        onClose={() => setHistoryArchive(null)}
        title={`Jejak Revisi & Pengarsipan — ${historyArchive?.spsNumber || ''}`}
        maxWidth="max-w-2xl"
      >
        {historyArchive && (
          <div className="space-y-4 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-1">
              <div><span className="text-slate-500">Alasan Pengarsipan:</span> <span className="font-medium">{historyArchive.archivalReason}</span></div>
              <div><span className="text-slate-500">Status Immutabilitas:</span> <StatusTag status={historyArchive.spsDocument?.isImmutable ? 'ARCHIVED' : 'ACTIVE'} /></div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-800 mb-2">Riwayat Revisi Dokumen</h4>
              <div className="border border-slate-200 rounded divide-y divide-slate-100">
                {historyArchive.revisions.length === 0 ? (
                  <div className="p-3 text-slate-500">Belum ada revisi tambahan.</div>
                ) : (
                  historyArchive.revisions.map((r) => (
                    <div key={r.id} className="p-3 flex justify-between gap-2">
                      <div>
                        <span className="font-semibold">Rev. {r.revisionNumber}</span> — {r.changeReason} ({r.revisedByName})
                      </div>
                      <div className="text-slate-400 tabular-nums">{formatDateId(r.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-800 mb-2">Peristiwa Siklus Hidup</h4>
              <div className="border border-slate-200 rounded divide-y divide-slate-100">
                {historyArchive.events.map((ev) => (
                  <div key={ev.id} className="p-3 flex justify-between gap-2">
                    <div>
                      <span className="font-mono font-semibold">{ev.eventType}</span> oleh {ev.actorName}
                    </div>
                    <div className="text-slate-400 tabular-nums">{formatDateId(ev.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
