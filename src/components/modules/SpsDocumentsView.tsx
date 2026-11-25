import React, { useEffect, useState } from 'react';
import { FilePlus2, Eye, Download, Edit3, Archive, Clock } from 'lucide-react';
import { apiFetch, openAuthenticatedPdf } from '../../lib/api';
import type { AppUser, SamplingRequest, SpsDocument } from '../../types/ankal';
import { EmptyState, ModalDialog, SkeletonTable, StatusTag } from '../ui/Common';
import { SpsPrintPreview } from '../SpsPrintPreview';

export function SpsDocumentsView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const [docs, setDocs] = useState<SpsDocument[]>([]);
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<SpsDocument | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genReqId, setGenReqId] = useState('');
  const [genNotes, setGenNotes] = useState('');
  const [genCreateTemplate, setGenCreateTemplate] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [reviseDoc, setReviseDoc] = useState<SpsDocument | null>(null);
  const [revNotes, setRevNotes] = useState('');
  const [revReason, setRevReason] = useState('');

  const [archivalModal, setArchivalModal] = useState<{
    doc: SpsDocument;
    decision: 'ARCHIVE' | 'DEFER';
  } | null>(null);
  const [archivalReason, setArchivalReason] = useState('');

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [spsList, reqList] = await Promise.all([
        apiFetch<SpsDocument[]>('/api/sps'),
        apiFetch<SamplingRequest[]>('/api/requests'),
      ]);
      setDocs(spsList);
      setRequests(reqList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dokumen SPS.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeDocs = docs.filter((d) => d.lifecycleStatus !== 'ARCHIVED');
  const readyRequests = requests.filter(
    (r) =>
      ['ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status) &&
      !r.spsDocument &&
      r.assignments.some((a) => a.assignmentStatus === 'CONFIRMED')
  );

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genReqId) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/sps/generate', {
        method: 'POST',
        body: JSON.stringify({
          requestId: genReqId,
          notes: genNotes,
          createTemplate: genCreateTemplate,
        }),
      });
      setGenerateOpen(false);
      setGenNotes('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menerbitkan SPS.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviseDoc) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/sps/${reviseDoc.id}/revise`, {
        method: 'POST',
        body: JSON.stringify({
          notes: revNotes,
          changeReason: revReason,
        }),
      });
      setReviseDoc(null);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal merevisi SPS.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchivalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivalModal) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/sps/${archivalModal.doc.id}/archival-decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision: archivalModal.decision,
          reason: archivalReason.trim() || 'Keputusan pengarsipan SPV Sampling',
        }),
      });
      setArchivalModal(null);
      setArchivalReason('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memproses keputusan arsip.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <SkeletonTable rows={5} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dokumen SPS Aktif</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Penerbitan Surat Pengantar Pengambilan Contoh Uji (<span className="font-mono">ANKAL-FO-7.1-01</span>), revisi, pratinjau A4, dan konfirmasi arsip pasca jadwal.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={readyRequests.length === 0}
            onClick={() => {
              setGenReqId(readyRequests[0]?.id || '');
              setGenNotes(readyRequests[0]?.specialInstructions || '');
              setGenerateOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-50 cursor-pointer"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>Terbitkan SPS Baru ({readyRequests.length})</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>
      )}

      {activeDocs.length === 0 ? (
        <EmptyState
          title="Belum ada dokumen SPS aktif"
          description="SPS dapat diterbitkan setelah permintaan disetujui dan penugasan tim lapangan terkonfirmasi."
        />
      ) : (
        <div className="space-y-4">
          {activeDocs.map((doc) => {
            const needsArchivalPrompt =
              doc.lifecycleStatus === 'PENDING_ARCHIVAL' || doc.archivalEvaluation?.shouldPromptArchival;

            return (
              <div key={doc.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                        {doc.spsNumber}
                      </span>
                      <StatusTag status={doc.lifecycleStatus} />
                      <span className="text-xs text-slate-500 tabular-nums">Rev. {doc.revisionNumber}</span>
                    </div>
                    <div className="font-semibold text-slate-900">{doc.customerName}</div>
                    <div className="text-xs text-slate-600">{doc.jobName}</div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      Jadwal: {doc.samplingDateLabel} · Petugas: {doc.assignedPersonnelNames.join(', ') || '-'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(doc)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Pratinjau A4</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openAuthenticatedPdf(`/api/sps/${doc.id}/pdf`, true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unduh PDF</span>
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviseDoc(doc);
                          setRevNotes(doc.notes);
                          setRevReason('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Revisi</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Post-Schedule Archival Confirmation Prompt */}
                {canManage && needsArchivalPrompt && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-start gap-2 text-xs text-amber-900">
                      <Clock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                      <span>
                        Jadwal pengambilan contoh uji untuk SPS <span className="font-semibold">{doc.spsNumber}</span> telah melewati tanggal pelaksanaan. Apakah dokumen ini ingin dipindahkan ke arsip?
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setArchivalReason('');
                          setArchivalModal({ doc, decision: 'DEFER' });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                      >
                        TIDAK — PERTAHANKAN AKTIF
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArchivalReason('');
                          setArchivalModal({ doc, decision: 'ARCHIVE' });
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>YA — ARSIPKAN</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* A4 Preview Modal */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc ? `Pratinjau Dokumen SPS — ${previewDoc.spsNumber}` : ''}
        maxWidth="max-w-5xl"
      >
        {previewDoc && <SpsPrintPreview doc={previewDoc} />}
      </ModalDialog>

      {/* Generate SPS Modal */}
      <ModalDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title="Terbitkan Dokumen SPS Resmi"
        subtitle="Nomor surat akan dibuat otomatis sesuai format penomoran sistem PT ANKAL."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Pekerjaan dengan Tim Terkonfirmasi *</label>
            <select
              required
              value={genReqId}
              onChange={(e) => {
                setGenReqId(e.target.value);
                const r = readyRequests.find((x) => x.id === e.target.value);
                setGenNotes(r?.specialInstructions || '');
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              {readyRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.requestNumber} — {r.customerName} ({r.jobName})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Bagian C (SPS)</label>
            <textarea
              rows={3}
              value={genNotes}
              onChange={(e) => setGenNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-800">
            <input
              type="checkbox"
              checked={genCreateTemplate}
              onChange={(e) => setGenCreateTemplate(e.target.checked)}
            />
            <span>Simpan juga sebagai entri di Pustaka Template SPS</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setGenerateOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Menerbitkan...' : 'Terbitkan SPS'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Revise SPS Modal */}
      <ModalDialog
        open={Boolean(reviseDoc)}
        onClose={() => setReviseDoc(null)}
        title={`Revisi SPS — ${reviseDoc?.spsNumber || ''}`}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleReviseSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Revisi *</label>
            <input
              type="text"
              required
              value={revReason}
              onChange={(e) => setRevReason(e.target.value)}
              placeholder="Contoh: Penyesuaian catatan keselamatan kerja"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Bagian C Terbaru</label>
            <textarea
              rows={3}
              value={revNotes}
              onChange={(e) => setRevNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setReviseDoc(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md"
            >
              Simpan Revisi
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Archival Decision Modal */}
      <ModalDialog
        open={Boolean(archivalModal)}
        onClose={() => setArchivalModal(null)}
        title={archivalModal?.decision === 'ARCHIVE' ? 'Arsipkan Dokumen SPS' : 'Pertahankan Dokumen SPS Aktif'}
        subtitle={archivalModal?.doc.spsNumber}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleArchivalSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan Keputusan</label>
            <textarea
              rows={3}
              value={archivalReason}
              onChange={(e) => setArchivalReason(e.target.value)}
              placeholder="Catatan alasan pengarsipan atau penundaan arsip..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setArchivalModal(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md"
            >
              Konfirmasi
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
