import React, { useEffect, useState } from 'react';
import { CalendarCheck, CalendarX2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser } from '../../types/ankal';
import { ModalDialog, SkeletonTable, StatusTag } from '../ui/Common';

interface AvailabilityResponse {
  targetStart: string;
  targetEnd: string;
  personnelAvailability: Array<{
    personnel: {
      id: string;
      code: string;
      fullName: string;
      category: 'INTERNAL' | 'EXTERNAL';
      position: string;
      baseLocation: string;
      employmentStatus: string;
      fieldEligible: boolean;
    };
    evaluation: {
      status: string;
      source: string;
      reasons: string[];
      hasConfirmedConflict: boolean;
      hasTentativeOverlap: boolean;
      manualOverrideApplied: boolean;
    };
  }>;
}

export function AvailabilityView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${todayStr}T08:00`);
  const [endDate, setEndDate] = useState(`${todayStr}T17:00`);
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualModal, setManualModal] = useState<{
    personnelId: string;
    fullName: string;
  } | null>(null);
  const [manualStatus, setManualStatus] = useState<'AVAILABLE' | 'UNAVAILABLE' | 'TENTATIVE' | 'ON_LEAVE'>('AVAILABLE');
  const [manualReason, setManualReason] = useState('');

  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    personnelId: '',
    leaveType: 'ANNUAL' as 'ANNUAL' | 'SICK' | 'TRAINING' | 'OTHER',
    startDate: `${todayStr}T00:00`,
    endDate: `${todayStr}T23:59`,
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadAvailability = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        start: new Date(startDate).toISOString(),
        end: new Date(endDate).toISOString(),
      });
      const res = await apiFetch<AvailabilityResponse>(`/api/availability?${qs.toString()}`);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghitung ketersediaan personel.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
  }, []);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualModal) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/availability/manual', {
        method: 'POST',
        body: JSON.stringify({
          personnelId: manualModal.personnelId,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          status: manualStatus,
          reason: manualReason,
        }),
      });
      setManualModal(null);
      setManualReason('');
      await loadAvailability();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengonfirmasi ketersediaan manual.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/leaves', {
        method: 'POST',
        body: JSON.stringify({
          ...leaveForm,
          startDate: new Date(leaveForm.startDate).toISOString(),
          endDate: new Date(leaveForm.endDate).toISOString(),
        }),
      });
      setLeaveModalOpen(false);
      await loadAvailability();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mencatat cuti/izin.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Ketersediaan Personel (Hybrid)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Kalkulasi otomatis berbasis jadwal penugasan, cuti, dan buffer mobilisasi, dilengkapi konfirmasi manual SPV.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setLeaveForm((prev) => ({
                ...prev,
                personnelId: data?.personnelAvailability[0]?.personnel.id || '',
              }));
              setLeaveModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
          >
            <CalendarX2 className="w-4 h-4" />
            <span>Catat Cuti / Pelatihan</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Date Range Checker */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Mulai Target</label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Waktu Selesai Target</label>
          <input
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <button
          type="button"
          onClick={loadAvailability}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Periksa Ketersediaan</span>
        </button>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Personel</th>
                  <th className="px-4 py-3 font-medium">Status Ketersediaan</th>
                  <th className="px-4 py-3 font-medium">Sumber Penentuan</th>
                  <th className="px-4 py-3 font-medium">Alasan / Deteksi Bentrok</th>
                  {canManage && <th className="px-4 py-3 font-medium text-right">Konfirmasi Manual</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.personnelAvailability || []).map(({ personnel: p, evaluation }) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs text-slate-500 tabular-nums">
                        {p.code} · {p.category === 'INTERNAL' ? 'Internal' : 'Freelance'}
                      </div>
                      <div className="font-semibold text-slate-900">{p.fullName}</div>
                      <div className="text-xs text-slate-500">{p.baseLocation}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusTag status={evaluation.status} />
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-700">
                      <span className="font-medium">
                        {evaluation.source === 'AUTO_COMPUTED' ? 'Otomatis Sistem' : 'Konfirmasi Manual SPV'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-600">
                      {evaluation.reasons.length > 0 ? (
                        <ul className="list-disc pl-4 space-y-0.5">
                          {evaluation.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-emerald-700">Siap ditugaskan tanpa bentrok jadwal.</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 align-top text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setManualModal({ personnelId: p.id, fullName: p.fullName });
                            setManualStatus('AVAILABLE');
                            setManualReason('');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                        >
                          <CalendarCheck className="w-3.5 h-3.5" />
                          <span>Konfirmasi Manual</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Confirmation Modal */}
      <ModalDialog
        open={Boolean(manualModal)}
        onClose={() => setManualModal(null)}
        title={`Konfirmasi Ketersediaan Manual — ${manualModal?.fullName || ''}`}
        subtitle="Sistem menolak status TERSEDIA apabila personel memiliki penugasan terkonfirmasi atau cuti aktif pada rentang waktu ini."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Status Ketersediaan</label>
            <select
              value={manualStatus}
              onChange={(e) => setManualStatus(e.target.value as typeof manualStatus)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="AVAILABLE">Tersedia (Konfirmasi Siap Tugas)</option>
              <option value="TENTATIVE">Tentatif</option>
              <option value="UNAVAILABLE">Tidak Tersedia</option>
              <option value="ON_LEAVE">Cuti / Izin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catatan / Alasan *</label>
            <textarea
              required
              rows={3}
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              placeholder="Contoh: Telah dikonfirmasi via telepon untuk kesiapan standby luar kota"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setManualModal(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Konfirmasi'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Record Leave Modal */}
      <ModalDialog
        open={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        title="Catat Cuti / Izin / Pelatihan Personel"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleLeaveSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Personel *</label>
            <select
              required
              value={leaveForm.personnelId}
              onChange={(e) => setLeaveForm({ ...leaveForm, personnelId: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              {(data?.personnelAvailability || []).map(({ personnel: p }) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Jenis Ketidakhadiran *</label>
            <select
              value={leaveForm.leaveType}
              onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value as typeof leaveForm.leaveType })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="ANNUAL">Cuti Tahunan</option>
              <option value="SICK">Izin Sakit</option>
              <option value="TRAINING">Pelatihan / Sertifikasi</option>
              <option value="OTHER">Lainnya</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mulai *</label>
              <input
                type="datetime-local"
                required
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Selesai *</label>
              <input
                type="datetime-local"
                required
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
            <input
              type="text"
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setLeaveModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              Simpan Cuti
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
