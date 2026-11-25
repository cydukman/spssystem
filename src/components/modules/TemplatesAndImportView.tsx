import React, { useEffect, useState } from 'react';
import {
  Search,
  CopyPlus,
  Upload,
  FileSpreadsheet,
  FileText,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { apiFetch, openAuthenticatedPdf } from '../../lib/api';
import type { AppUser, SpsDocument, SpsTemplate } from '../../types/ankal';
import { EmptyState, ModalDialog, SkeletonTable, StatusTag, formatDateId } from '../ui/Common';
import { SpsPrintPreview } from '../SpsPrintPreview';

interface ImportRecord {
  id: string;
  batchId: string;
  sourcePage: number;
  extractedData: Record<string, unknown>;
  confidenceData: Record<string, number>;
  validationStatus: string;
  duplicateStatus: string;
  duplicateSpsId: string | null;
  missingFields: string[];
  warnings: string[];
}

interface ImportBatch {
  id: string;
  originalFilename: string;
  fileType: string;
  processingStatus: string;
  totalRecords: number;
  successfulRecords: number;
  duplicateRecords: number;
  failedRecords: number;
  uploadedByName: string;
  uploadedAt: string;
  records: ImportRecord[];
}

export function TemplatesAndImportView({
  user,
  onNavigate,
  onChanged,
}: {
  user: AppUser;
  onNavigate: (route: string) => void;
  onChanged: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'TEMPLATES' | 'IMPORT' | 'HISTORY'>('TEMPLATES');
  const [templates, setTemplates] = useState<SpsTemplate[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [previewDoc, setPreviewDoc] = useState<SpsDocument | null>(null);

  // Import state
  const [uploading, setUploading] = useState(false);
  const [columnMapping, setColumnMapping] = useState({
    document_number: '',
    customer_name: '',
    job_name: '',
    sampling_date: '',
    matrix_name: '',
    parameters: '',
  });
  const [activeBatch, setActiveBatch] = useState<ImportBatch | null>(null);
  const [editingRecord, setEditingRecord] = useState<ImportRecord | null>(null);
  const [editFields, setEditFields] = useState({
    document_number: '',
    customer_name: '',
    customer_address: '',
    customer_pic: '',
    pic_phone: '',
    job_name: '',
    sampling_date: '',
    sampling_location: '',
    notes: '',
    resolveDuplicateAsSeparate: false,
  });
  const [deleteTargetTpl, setDeleteTargetTpl] = useState<SpsTemplate | null>(null);
  const [deletingTpl, setDeletingTpl] = useState(false);

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [tpls, bList] = await Promise.all([
        apiFetch<SpsTemplate[]>('/api/templates'),
        apiFetch<ImportBatch[]>('/api/import/batches'),
      ]);
      setTemplates(tpls);
      setBatches(bList);
      if (activeBatch) {
        const refreshed = bList.find((b) => b.id === activeBatch.id);
        if (refreshed) setActiveBatch(refreshed);
      } else if (bList.length > 0) {
        setActiveBatch(bList[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pustaka template dan impor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredTemplates = templates.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.templateName.toLowerCase().includes(q) ||
      t.originalSpsNumber.toLowerCase().includes(q) ||
      t.customerName.toLowerCase().includes(q) ||
      t.jobName.toLowerCase().includes(q) ||
      t.matrixConfig.some((m) => m.matrixName.toLowerCase().includes(q))
    );
  });

  const handleUseTemplate = async (tpl: SpsTemplate) => {
    setError(null);
    setSuccessMsg(null);
    try {
      const created = await apiFetch<{ requestNumber: string }>(`/api/templates/${tpl.id}/use`, {
        method: 'POST',
      });
      setSuccessMsg(
        `Draft permintaan baru (${created.requestNumber}) berhasil dibuat dari template ${tpl.originalSpsNumber} tanpa mengubah dokumen SPS asli.`
      );
      onChanged();
      setTimeout(() => onNavigate('requests'), 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menggunakan template.');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTargetTpl) return;
    setDeletingTpl(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/templates/${deleteTargetTpl.id}`, { method: 'DELETE' });
      setSuccessMsg(`Template ${deleteTargetTpl.originalSpsNumber} berhasil dihapus.`);
      setDeleteTargetTpl(null);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus template.');
    } finally {
      setDeletingTpl(false);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const customMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(columnMapping)) {
        if (v.trim()) customMap[k] = v.trim();
      }
      if (Object.keys(customMap).length > 0) {
        fd.append('columnMapping', JSON.stringify(customMap));
      }
      const res = await apiFetch<{ batch: ImportBatch; records: ImportRecord[] }>('/api/import/excel', {
        method: 'POST',
        body: fd,
      });
      setSuccessMsg(`Berhasil mengekstrak ${res.records.length} baris dari ${file.name}.`);
      setActiveBatch({ ...res.batch, records: res.records });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah file Excel/CSV.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{
        batch: ImportBatch;
        records: ImportRecord[];
        extractionMethod: string;
        pageCount: number;
      }>('/api/import/pdf', {
        method: 'POST',
        body: fd,
      });
      setSuccessMsg(
        `Berhasil mengekstrak ${res.records.length} dokumen SPS dari ${res.pageCount} halaman (${res.extractionMethod}).`
      );
      setActiveBatch({ ...res.batch, records: res.records });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengekstrak PDF SPS.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleSampleHistoricalPdf = async () => {
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{
        batch: ImportBatch;
        records: ImportRecord[];
        extractionMethod: string;
        pageCount: number;
      }>('/api/import/sample-historical-pdf', { method: 'POST' });
      setSuccessMsg(
        `PDF Historis ANKAL (${res.pageCount} halaman) diekstrak: ${res.records.length} catatan SPS siap ditinjau.`
      );
      setActiveBatch({ ...res.batch, records: res.records });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengekstrak PDF historis bawaan.');
    } finally {
      setUploading(false);
    }
  };

  const openReviewRecord = (rec: ImportRecord) => {
    const d = rec.extractedData || {};
    setEditingRecord(rec);
    setEditFields({
      document_number: String(d.document_number || ''),
      customer_name: String(d.customer_name || ''),
      customer_address: String(d.customer_address || ''),
      customer_pic: String(d.customer_pic || ''),
      pic_phone: String(d.pic_phone || ''),
      job_name: String(d.job_name || ''),
      sampling_date: String(d.sampling_date || ''),
      sampling_location: String(d.sampling_location || ''),
      notes: String(d.notes || ''),
      resolveDuplicateAsSeparate: false,
    });
  };

  const handleSaveRecordDraft = async () => {
    if (!editingRecord) return;
    setError(null);
    try {
      const merged = {
        ...editingRecord.extractedData,
        document_number: editFields.document_number,
        customer_name: editFields.customer_name,
        customer_address: editFields.customer_address,
        customer_pic: editFields.customer_pic,
        pic_phone: editFields.pic_phone,
        job_name: editFields.job_name,
        sampling_date: editFields.sampling_date,
        sampling_location: editFields.sampling_location,
        notes: editFields.notes,
      };
      await apiFetch(`/api/import/records/${editingRecord.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ extractedData: merged, validationStatus: 'DRAFT' }),
      });
      setEditingRecord(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan draf baris impor.');
    }
  };

  const handleConfirmImportRecord = async () => {
    if (!editingRecord) return;
    setError(null);
    try {
      // Save edits first, then confirm
      const merged = {
        ...editingRecord.extractedData,
        document_number: editFields.document_number,
        customer_name: editFields.customer_name,
        customer_address: editFields.customer_address,
        customer_pic: editFields.customer_pic,
        pic_phone: editFields.pic_phone,
        job_name: editFields.job_name,
        sampling_date: editFields.sampling_date,
        sampling_location: editFields.sampling_location,
        notes: editFields.notes,
      };
      await apiFetch(`/api/import/records/${editingRecord.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ extractedData: merged }),
      });
      const created = await apiFetch<{ spsNumber: string }>(`/api/import/records/${editingRecord.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          resolveDuplicateAsSeparate: editFields.resolveDuplicateAsSeparate,
          overrideSpsNumber: editFields.document_number,
        }),
      });
      setSuccessMsg(`SPS ${created.spsNumber} berhasil diimpor ke Arsip Dokumen & Pustaka Template.`);
      setEditingRecord(null);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengonfirmasi impor SPS.');
    }
  };

  const handleRejectRecord = async (recordId: string) => {
    setError(null);
    try {
      const rec = activeBatch?.records.find((r) => r.id === recordId);
      await apiFetch(`/api/import/records/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          extractedData: rec?.extractedData || {},
          validationStatus: 'REJECTED',
        }),
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menolak baris impor.');
    }
  };

  if (loading) return <SkeletonTable rows={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pustaka Template &amp; Pusat Impor SPS</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Gunakan ulang template SPS historis sebagai permintaan baru, atau impor database master dari Excel/CSV dan PDF.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-300 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setActiveTab('TEMPLATES')}
            className={`px-3.5 py-2 text-xs font-medium cursor-pointer ${
              activeTab === 'TEMPLATES' ? 'bg-[#25AC43] text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Pustaka Template ({templates.length})
          </button>
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('IMPORT')}
                className={`px-3.5 py-2 text-xs font-medium cursor-pointer ${
                  activeTab === 'IMPORT' ? 'bg-[#25AC43] text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                Pusat Impor Excel &amp; PDF
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('HISTORY')}
                className={`px-3.5 py-2 text-xs font-medium cursor-pointer ${
                  activeTab === 'HISTORY' ? 'bg-[#25AC43] text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                Riwayat Impor ({batches.length})
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-700">
          {successMsg}
        </div>
      )}

      {/* TAB 1: TEMPLATES */}
      {activeTab === 'TEMPLATES' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari template berdasarkan nomor SPS, pelanggan, nama pekerjaan, atau matriks..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          {filteredTemplates.length === 0 ? (
            <EmptyState
              title="Template SPS tidak ditemukan"
              description="Terbitkan SPS baru dengan opsi template atau impor file SPS historis."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTemplates.map((tpl) => (
                <div key={tpl.id} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#166534] tabular-nums">
                        {tpl.originalSpsNumber}
                      </span>
                      <span className="text-slate-400 tabular-nums">v{tpl.version}</span>
                    </div>
                    <h3 className="font-semibold text-slate-900">{tpl.customerName}</h3>
                    <p className="text-xs text-slate-600">{tpl.jobName}</p>
                    <div className="text-xs text-slate-500 pt-1">
                      Matriks: {tpl.matrixConfig.map((m) => `${m.matrixName} (${m.pointCount} ttk)`).join(', ') || '-'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      {tpl.sourceSps ? (
                        <button
                          type="button"
                          onClick={() => setPreviewDoc(tpl.sourceSps || null)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Lihat SPS Asli</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Template Standar</span>
                      )}

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setDeleteTargetTpl(tpl)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUseTemplate(tpl)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                    >
                      <CopyPlus className="w-3.5 h-3.5" />
                      <span>Gunakan sebagai Template</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IMPORT CENTER */}
      {activeTab === 'IMPORT' && canManage && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Excel / CSV Import Box */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded bg-[#f0fdf4] text-[#166534]">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Impor Excel / CSV (.xlsx, .xls, .csv)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pemetaan otomatis header Indonesia/Inggris atau sesuaikan nama kolom kustom sebelum unggah.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  value={columnMapping.document_number}
                  onChange={(e) => setColumnMapping({ ...columnMapping, document_number: e.target.value })}
                  placeholder="Kolom No. SPS (opsional)"
                  className="px-2.5 py-1.5 border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={columnMapping.customer_name}
                  onChange={(e) => setColumnMapping({ ...columnMapping, customer_name: e.target.value })}
                  placeholder="Kolom Pelanggan (opsional)"
                  className="px-2.5 py-1.5 border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={columnMapping.job_name}
                  onChange={(e) => setColumnMapping({ ...columnMapping, job_name: e.target.value })}
                  placeholder="Kolom Pekerjaan (opsional)"
                  className="px-2.5 py-1.5 border border-slate-300 rounded"
                />
                <input
                  type="text"
                  value={columnMapping.matrix_name}
                  onChange={(e) => setColumnMapping({ ...columnMapping, matrix_name: e.target.value })}
                  placeholder="Kolom Matriks (opsional)"
                  className="px-2.5 py-1.5 border border-slate-300 rounded"
                />
              </div>

              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{uploading ? 'Memproses...' : 'Unggah File Excel / CSV'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={uploading}
                  onChange={handleExcelUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* PDF Import Box */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded bg-blue-50 text-blue-700">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Impor PDF SPS (Teks &amp; Scan OCR AI)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mengekstrak dokumen SPS tunggal maupun multi-halaman menggunakan Gemini AI OCR terstruktur.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-4">
                <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>{uploading ? 'Mengekstrak PDF...' : 'Unggah File PDF SPS'}</span>
                  <input
                    type="file"
                    accept=".pdf"
                    disabled={uploading}
                    onChange={handlePdfUpload}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  disabled={uploading}
                  onClick={handleSampleHistoricalPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-60"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#25AC43]" />
                  <span>Uji Ekstrak PDF Historis ANKAL (38 Hal)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Extraction Review Workspace */}
          {activeBatch && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Review Hasil Ekstraksi: {activeBatch.originalFilename}
                  </h3>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Total {activeBatch.totalRecords} catatan · {activeBatch.successfulRecords} terimpor · {activeBatch.duplicateRecords} potensi duplikat
                  </p>
                </div>
                {activeBatch.fileType === 'PDF' && (
                  <button
                    type="button"
                    onClick={() => openAuthenticatedPdf(`/api/import/batches/${activeBatch.id}/source-file`)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] hover:underline cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka PDF Sumber Asli</span>
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Hal / Baris</th>
                      <th className="px-4 py-2.5 font-medium">Nomor SPS &amp; Pelanggan</th>
                      <th className="px-4 py-2.5 font-medium">Pekerjaan &amp; Tanggal</th>
                      <th className="px-4 py-2.5 font-medium">Status &amp; Peringatan</th>
                      <th className="px-4 py-2.5 font-medium text-right">Aksi Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeBatch.records.map((rec) => {
                      const d = rec.extractedData || {};
                      return (
                        <tr key={rec.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 tabular-nums font-mono text-slate-500">
                            #{rec.sourcePage}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono font-semibold text-slate-900">
                              {String(d.document_number || '(Nomor Kosong)')}
                            </div>
                            <div className="text-slate-700">{String(d.customer_name || '-')}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-800">{String(d.job_name || '-')}</div>
                            <div className="text-slate-500 tabular-nums">{String(d.sampling_date || '-')}</div>
                          </td>
                          <td className="px-4 py-3 space-y-1">
                            <StatusTag status={rec.validationStatus} />
                            {rec.duplicateStatus !== 'NONE' && rec.duplicateStatus !== 'RESOLVED_SEPARATE' && (
                              <div className="text-amber-700 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Duplikat: {rec.duplicateStatus}</span>
                              </div>
                            )}
                            {rec.warnings?.length > 0 && (
                              <div className="text-slate-500">{rec.warnings[0]}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                            {rec.validationStatus !== 'IMPORTED' && rec.validationStatus !== 'REJECTED' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openReviewRecord(rec)}
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                                >
                                  Tinjau &amp; Konfirmasi
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectRecord(rec.id)}
                                  className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 cursor-pointer"
                                >
                                  Tolak
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: IMPORT HISTORY */}
      {activeTab === 'HISTORY' && canManage && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nama File</th>
                  <th className="px-4 py-3 font-medium">Tipe</th>
                  <th className="px-4 py-3 font-medium">Total / Sukses / Duplikat</th>
                  <th className="px-4 py-3 font-medium">Diunggah Oleh</th>
                  <th className="px-4 py-3 font-medium text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{b.originalFilename}</td>
                    <td className="px-4 py-3 text-xs font-mono">{b.fileType}</td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {b.totalRecords} total · {b.successfulRecords} sukses · {b.duplicateRecords} duplikat
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {b.uploadedByName} · {formatDateId(b.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveBatch(b);
                          setActiveTab('IMPORT');
                        }}
                        className="px-3 py-1 text-xs font-medium text-[#166534] bg-[#f0fdf4] border border-[#25AC43]/40 rounded cursor-pointer"
                      >
                        Buka Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Source SPS Preview Modal */}
      <ModalDialog
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc ? `Pratinjau SPS Asli — ${previewDoc.spsNumber}` : ''}
        maxWidth="max-w-5xl"
      >
        {previewDoc && <SpsPrintPreview doc={previewDoc} />}
      </ModalDialog>

      {/* Extraction Record Edit & Confirm Modal */}
      <ModalDialog
        open={Boolean(editingRecord)}
        onClose={() => setEditingRecord(null)}
        title="Validasi & Konfirmasi Hasil Ekstraksi SPS"
        subtitle={
          editingRecord
            ? `Sumber halaman/baris #${editingRecord.sourcePage} · Status Duplikat: ${editingRecord.duplicateStatus}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {editingRecord && (
          <div className="space-y-4">
            {editingRecord.duplicateStatus !== 'NONE' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-2">
                <div className="font-semibold">
                  Potensi duplikat terdeteksi ({editingRecord.duplicateStatus}).
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editFields.resolveDuplicateAsSeparate}
                    onChange={(e) =>
                      setEditFields({ ...editFields, resolveDuplicateAsSeparate: e.target.checked })
                    }
                  />
                  <span>Impor sebagai catatan sumber historis terpisah (tambahkan sufiks unik otomatis)</span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nomor SPS *</label>
                <input
                  type="text"
                  value={editFields.document_number}
                  onChange={(e) => setEditFields({ ...editFields, document_number: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Pelanggan *</label>
                <input
                  type="text"
                  value={editFields.customer_name}
                  onChange={(e) => setEditFields({ ...editFields, customer_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Nama Pekerjaan *</label>
                <input
                  type="text"
                  value={editFields.job_name}
                  onChange={(e) => setEditFields({ ...editFields, job_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Tanggal Sampling</label>
                <input
                  type="text"
                  value={editFields.sampling_date}
                  onChange={(e) => setEditFields({ ...editFields, sampling_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">PIC Pelanggan</label>
                <input
                  type="text"
                  value={editFields.customer_pic}
                  onChange={(e) => setEditFields({ ...editFields, customer_pic: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">No. HP PIC</label>
                <input
                  type="text"
                  value={editFields.pic_phone}
                  onChange={(e) => setEditFields({ ...editFields, pic_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Lokasi Sampling</label>
                <input
                  type="text"
                  value={editFields.sampling_location}
                  onChange={(e) => setEditFields({ ...editFields, sampling_location: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Catatan</label>
                <textarea
                  rows={2}
                  value={editFields.notes}
                  onChange={(e) => setEditFields({ ...editFields, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveRecordDraft}
                className="px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded"
              >
                Simpan Draft
              </button>
              <button
                type="button"
                onClick={handleConfirmImportRecord}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Konfirmasi &amp; Impor ke Arsip + Template</span>
              </button>
            </div>
          </div>
        )}
      </ModalDialog>

      {/* Confirm Delete Template Modal */}
      <ModalDialog
        open={Boolean(deleteTargetTpl)}
        onClose={() => !deletingTpl && setDeleteTargetTpl(null)}
        title="Hapus Template SPS"
        subtitle={
          deleteTargetTpl
            ? `${deleteTargetTpl.originalSpsNumber} — ${deleteTargetTpl.customerName}`
            : ''
        }
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Template ini akan dihapus dari pustaka template. Dokumen SPS asli yang sudah diterbitkan atau diarsipkan tidak akan terpengaruh.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={deletingTpl}
              onClick={() => setDeleteTargetTpl(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deletingTpl}
              onClick={handleDeleteTemplate}
              className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-md cursor-pointer"
            >
              {deletingTpl ? 'Menghapus...' : 'Ya, Hapus Template'}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
