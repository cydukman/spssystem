import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Users, CheckCircle2, RefreshCw, Trash2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser, PersonnelRecord, SamplingRequest } from '../../types/ankal';
import { EmptyState, ModalDialog, SkeletonTable, StatusTag, formatDateRangeId } from '../ui/Common';

interface RecommendationItem {
  personnel: {
    id: string;
    code: string;
    fullName: string;
    category: 'INTERNAL' | 'EXTERNAL';
    baseLocation: string;
    fieldEligible: boolean;
  };
  availability: {
    status: string;
    reasons: string[];
    hasConfirmedConflict: boolean;
  };
  score: number;
  eligible: boolean;
  inclusionReasons: string[];
  exclusionReasons: string[];
}

export function SchedulingView({
  user,
  onNavigate,
  onChanged,
}: {
  user: AppUser;
  onNavigate: (route: string) => void;
  onChanged: () => void;
}) {
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [personnelList, setPersonnelList] = useState<PersonnelRecord[]>([]);
  const [selectedReqId, setSelectedReqId] = useState<string>('');
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [assignmentStatus, setAssignmentStatus] = useState<'CONFIRMED' | 'TENTATIVE'>('CONFIRMED');
  const [assignmentMode, setAssignmentMode] = useState<'MANUAL' | 'AUTO_RECOMMENDED'>('MANUAL');
  const [notes, setNotes] = useState('');
  const [teamMembers, setTeamMembers] = useState<
    Array<{ personnelId: string; roleInTeam: 'TEAM_LEADER' | 'MEMBER' | 'DRIVER' }>
  >([]);
  const [submitting, setSubmitting] = useState(false);

  // Replace Modal
  const [replaceModal, setReplaceModal] = useState<{
    assignmentId: string;
    oldName: string;
  } | null>(null);
  const [replaceNewPersonId, setReplaceNewPersonId] = useState('');
  const [replaceReason, setReplaceReason] = useState('');

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [reqs, pers] = await Promise.all([
        apiFetch<SamplingRequest[]>('/api/requests'),
        apiFetch<PersonnelRecord[]>('/api/personnel'),
      ]);
      setRequests(reqs);
      setPersonnelList(pers);

      const assignable = reqs.filter((r) =>
        ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status)
      );
      if (assignable.length > 0 && !selectedReqId) {
        setSelectedReqId(assignable[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data penjadwalan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedReq = useMemo(
    () => requests.find((r) => r.id === selectedReqId) || null,
    [requests, selectedReqId]
  );

  useEffect(() => {
    if (!selectedReq) return;
    const activeSch = selectedReq.schedules.find((s) => s.isActive);
    const sDate = activeSch ? new Date(activeSch.startDate) : new Date(selectedReq.proposedDate);
    const eDate = activeSch
      ? new Date(activeSch.endDate)
      : selectedReq.proposedEndDate && new Date(selectedReq.proposedEndDate) > sDate
      ? new Date(selectedReq.proposedEndDate)
      : new Date(sDate.getTime() + (selectedReq.estimatedDurationHours || 8) * 3600000);
    setStartDate(sDate.toISOString().slice(0, 16));
    setEndDate(eDate.toISOString().slice(0, 16));

    if (selectedReq.assignments && selectedReq.assignments.length > 0) {
      setTeamMembers(
        selectedReq.assignments.map((a) => ({
          personnelId: a.personnelId,
          roleInTeam: (a.roleInTeam as 'TEAM_LEADER' | 'MEMBER' | 'DRIVER') || 'MEMBER',
        }))
      );
    } else {
      setTeamMembers([]);
    }
    setRecommendations([]);
  }, [selectedReq]);

  const handleLoadRecommendations = async () => {
    if (!selectedReqId || !canManage) return;
    setLoadingRecs(true);
    setError(null);
    try {
      const res = await apiFetch<{ recommendations: RecommendationItem[] }>(
        `/api/assignments/recommendations/${selectedReqId}`
      );
      setRecommendations(res.recommendations);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat rekomendasi personel.');
    } finally {
      setLoadingRecs(false);
    }
  };

  const handleApplyTopRecommended = () => {
    const eligible = recommendations.filter((r) => r.eligible);
    if (eligible.length === 0) return;
    const topTwo = eligible.slice(0, 2).map((r, idx) => ({
      personnelId: r.personnel.id,
      roleInTeam: (idx === 0 ? 'TEAM_LEADER' : 'MEMBER') as 'TEAM_LEADER' | 'MEMBER',
    }));
    setTeamMembers(topTwo);
    setAssignmentMode('AUTO_RECOMMENDED');
  };

  const handleConfirmAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReqId || teamMembers.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch('/api/assignments', {
        method: 'POST',
        body: JSON.stringify({
          requestId: selectedReqId,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          assignmentStatus,
          assignmentMode,
          notes,
          members: teamMembers,
        }),
      });
      setSuccessMsg('Penugasan tim lapangan berhasil disimpan dan divalidasi.');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan penugasan personel.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replaceModal || !replaceNewPersonId) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/assignments/${replaceModal.assignmentId}/replace`, {
        method: 'POST',
        body: JSON.stringify({
          newPersonnelId: replaceNewPersonId,
          reason: replaceReason,
        }),
      });
      setReplaceModal(null);
      setReplaceReason('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengganti personel.');
    } finally {
      setSubmitting(false);
    }
  };

  const assignableRequests = requests.filter((r) =>
    ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status)
  );

  if (loading) return <SkeletonTable rows={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Penjadwalan &amp; Penugasan Personel</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Penugasan manual atau rekomendasi otomatis berbasis kompetensi, status kelayakan, dan deteksi bentrok.
          </p>
        </div>
        {!canManage && (
          <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
            Mode Hanya-Lihat: Hanya SPV Sampling atau Manajemen yang dapat mengonfirmasi penugasan.
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-700 flex items-center justify-between">
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => onNavigate('sps')}
            className="font-semibold underline cursor-pointer"
          >
            Lanjut ke Dokumen SPS →
          </button>
        </div>
      )}

      {assignableRequests.length === 0 ? (
        <EmptyState
          title="Belum ada permintaan yang siap ditugaskan"
          description="Permintaan sampling harus disetujui terlebih dahulu oleh SPV Sampling sebelum masuk ke antrean penugasan."
          actionLabel="Lihat Permintaan Sampling"
          onAction={() => onNavigate('requests')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Request Selector */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">Pekerjaan Siap Dijadwalkan</h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
              {assignableRequests.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedReqId(r.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    r.id === selectedReqId ? 'bg-[#f0fdf4] border-l-2 border-[#25AC43]' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-500 tabular-nums">{r.requestNumber}</span>
                    <StatusTag status={r.status} />
                  </div>
                  <div className="font-semibold text-sm text-slate-900 mt-1">{r.customerName}</div>
                  <div className="text-xs text-slate-600 line-clamp-1">{r.jobName}</div>
                  <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                    {formatDateRangeId(r.proposedDate, r.proposedEndDate)} · {r.matrices.map((m) => m.matrixName).join(', ')}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Assignment Workbench */}
          <div className="lg:col-span-8 space-y-5">
            {selectedReq && (
              <>
                <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">{selectedReq.jobName}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {selectedReq.customerName} · Lokasi: {selectedReq.samplingLocation}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={handleLoadRecommendations}
                        disabled={loadingRecs}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer disabled:opacity-60"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{loadingRecs ? 'Menganalisis...' : 'Jalankan Rekomendasi Otomatis'}</span>
                      </button>
                    )}
                  </div>

                  {/* Current Confirmed Assignments with Replace action */}
                  {selectedReq.assignments.length > 0 && canManage && (
                    <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 space-y-2">
                      <div className="text-xs font-semibold text-slate-700">Personel Saat Ini Terdaftar pada Jadwal:</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedReq.assignments.map((a) => {
                          const p = personnelList.find((x) => x.id === a.personnelId);
                          return (
                            <div
                              key={a.id}
                              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded text-xs"
                            >
                              <span className="font-medium text-slate-900">{p?.fullName || a.personnelId}</span>
                              <span className="text-slate-500">({a.roleInTeam})</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setReplaceModal({ assignmentId: a.id, oldName: p?.fullName || 'Personel' });
                                  setReplaceNewPersonId('');
                                  setReplaceReason('');
                                }}
                                className="text-amber-700 hover:underline font-medium ml-1 cursor-pointer"
                              >
                                Ganti
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Assignment Form */}
                  <form onSubmit={handleConfirmAssignment} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai</label>
                        <input
                          type="datetime-local"
                          required
                          disabled={!canManage}
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Selesai</label>
                        <input
                          type="datetime-local"
                          required
                          disabled={!canManage}
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Status Penugasan</label>
                        <select
                          disabled={!canManage}
                          value={assignmentStatus}
                          onChange={(e) => setAssignmentStatus(e.target.value as 'CONFIRMED' | 'TENTATIVE')}
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                        >
                          <option value="CONFIRMED">Terkonfirmasi (Confirmed)</option>
                          <option value="TENTATIVE">Tentatif (Sementara)</option>
                        </select>
                      </div>
                    </div>

                    {/* Team Builder */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-800">Komposisi Tim Sampling</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              const firstId = personnelList.find((p) => p.fieldEligible)?.id || personnelList[0]?.id || '';
                              setTeamMembers((prev) => [
                                ...prev,
                                { personnelId: firstId, roleInTeam: prev.length === 0 ? 'TEAM_LEADER' : 'MEMBER' },
                              ]);
                              setAssignmentMode('MANUAL');
                            }}
                            className="text-xs font-medium text-[#166534] hover:underline cursor-pointer"
                          >
                            + Tambah Anggota Tim
                          </button>
                        )}
                      </div>

                      {teamMembers.length === 0 ? (
                        <div className="text-xs text-slate-500 border border-dashed border-slate-300 rounded p-4 text-center">
                          Belum ada anggota tim dipilih. Tambahkan anggota secara manual atau gunakan Rekomendasi Otomatis.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {teamMembers.map((tm, idx) => (
                            <div key={idx} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                              <select
                                disabled={!canManage}
                                value={tm.personnelId}
                                onChange={(e) =>
                                  setTeamMembers((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, personnelId: e.target.value } : row))
                                  )
                                }
                                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                              >
                                {personnelList.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.code} — {p.fullName} ({p.category === 'INTERNAL' ? 'Internal' : 'Freelance'}
                                    {!p.fieldEligible ? ' · Belum Terverifikasi' : ''})
                                  </option>
                                ))}
                              </select>
                              <select
                                disabled={!canManage}
                                value={tm.roleInTeam}
                                onChange={(e) =>
                                  setTeamMembers((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? { ...row, roleInTeam: e.target.value as 'TEAM_LEADER' | 'MEMBER' | 'DRIVER' }
                                        : row
                                    )
                                  )
                                }
                                className="w-40 px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white"
                              >
                                <option value="TEAM_LEADER">Ketua Tim</option>
                                <option value="MEMBER">Petugas Sampling</option>
                                <option value="DRIVER">Pengemudi</option>
                              </select>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => setTeamMembers((prev) => prev.filter((_, i) => i !== idx))}
                                  aria-label="Hapus anggota"
                                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Penugasan</label>
                      <input
                        type="text"
                        disabled={!canManage}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Catatan peralatan, APD, atau instruksi mobilisasi..."
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                      />
                    </div>

                    {canManage && (
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="submit"
                          disabled={submitting || teamMembers.length === 0}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{submitting ? 'Memvalidasi...' : 'Konfirmasi Penugasan Tim'}</span>
                        </button>
                      </div>
                    )}
                  </form>
                </div>

                {/* Recommendation Results Table */}
                {recommendations.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Hasil Mesin Rekomendasi Personel</h3>
                        <p className="text-xs text-slate-500">
                          Peringkat dihitung berdasarkan kompetensi matriks, ketersediaan jadwal, status internal/freelance, dan lokasi base.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyTopRecommended}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                      >
                        Terapkan 2 Kandidat Terbaik
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {recommendations.map((rec) => (
                        <div key={rec.personnel.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono text-slate-500 tabular-nums">{rec.personnel.code}</span>
                              <span className="font-semibold text-slate-900 text-sm">{rec.personnel.fullName}</span>
                              <span className="text-slate-500">
                                ({rec.personnel.category === 'INTERNAL' ? 'Internal' : 'Freelance'} · {rec.personnel.baseLocation})
                              </span>
                            </div>
                            {rec.eligible ? (
                              <div className="text-xs text-emerald-700">
                                Skor {rec.score} — {rec.inclusionReasons.join(' · ')}
                              </div>
                            ) : (
                              <div className="text-xs text-red-700">
                                Tidak Direkomendasikan: {rec.exclusionReasons.join(' · ')}
                              </div>
                            )}
                          </div>
                          {rec.eligible && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!teamMembers.some((t) => t.personnelId === rec.personnel.id)) {
                                  setTeamMembers((prev) => [
                                    ...prev,
                                    {
                                      personnelId: rec.personnel.id,
                                      roleInTeam: prev.length === 0 ? 'TEAM_LEADER' : 'MEMBER',
                                    },
                                  ]);
                                  setAssignmentMode('AUTO_RECOMMENDED');
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-[#166534] bg-[#f0fdf4] border border-[#25AC43]/40 rounded hover:bg-[#dcfce7] whitespace-nowrap cursor-pointer"
                            >
                              + Pilih ke Tim
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Replace Assigned Personnel Modal */}
      <ModalDialog
        open={Boolean(replaceModal)}
        onClose={() => setReplaceModal(null)}
        title={`Ganti Personel Ditugaskan — ${replaceModal?.oldName || ''}`}
        subtitle="Penugasan lama akan dicatat dengan status Diganti dan tercatat di Log Audit."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleReplaceSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Personel Pengganti *</label>
            <select
              required
              value={replaceNewPersonId}
              onChange={(e) => setReplaceNewPersonId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="">-- Pilih Pengganti yang Layak --</option>
              {personnelList
                .filter((p) => p.fieldEligible && p.employmentStatus === 'ACTIVE')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.fullName} ({p.category === 'INTERNAL' ? 'Internal' : 'Freelance'})
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Penggantian *</label>
            <input
              type="text"
              required
              value={replaceReason}
              onChange={(e) => setReplaceReason(e.target.value)}
              placeholder="Contoh: Petugas sakit mendadak / penyesuaian kompetensi"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setReplaceModal(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              Konfirmasi Penggantian
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
