import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  Users,
  Truck,
  FileText,
  Archive,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser, SamplingRequest, SpsDocument } from '../../types/ankal';
import { StatusTag, formatDateId, formatDateRangeId, ModalDialog } from '../ui/Common';

interface DashboardPayload {
  role: string;
  kae: {
    myRequestsCount: number;
    draftCount: number;
    awaitingApprovalCount: number;
    revisionCount: number;
    approvedCount: number;
    upcomingSamplingCount: number;
    activeSpsCount: number;
    archivedSpsCount: number;
  };
  spv: {
    incomingRequestsCount: number;
    awaitingReviewCount: number;
    awaitingAssignmentCount: number;
    upcomingSamplingCount: number;
    availableInternalCount: number;
    availableFreelanceCount: number;
    assignedPersonnelCount: number;
    conflictCount: number;
    availableVehiclesCount: number;
    totalVehiclesCount: number;
    spsAwaitingGenerationCount: number;
    spsAwaitingArchivalCount: number;
  };
  management: {
    totalJobs: number;
    totalRequests: number;
    approvedJobs: number;
    pendingRequests: number;
    completedJobs: number;
    personnelUtilizationPct: number;
    internalAssignmentsCount: number;
    freelanceAssignmentsCount: number;
    vehicleUtilizationPct: number;
  };
  recentRequests: SamplingRequest[];
  upcomingSchedules: Array<{
    id: string;
    requestId: string;
    scheduleCode: string;
    activityName: string;
    startDate: string;
    endDate: string;
  }>;
  pendingArchivalSps: SpsDocument[];
  unreadNotificationsCount: number;
}

export function DashboardView({
  user,
  onNavigate,
  onNotificationsChanged,
}: {
  user: AppUser;
  onNavigate: (route: string) => void;
  onNotificationsChanged: () => void;
}) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archivalTarget, setArchivalTarget] = useState<{ doc: SpsDocument; decision: 'ARCHIVE' | 'DEFER' } | null>(null);
  const [archivalReason, setArchivalReason] = useState('');
  const [submittingArchival, setSubmittingArchival] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardPayload>('/api/dashboard');
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dasbor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [user.role]);

  const handleArchivalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivalTarget) return;
    setSubmittingArchival(true);
    try {
      await apiFetch(`/api/sps/${archivalTarget.doc.id}/archival-decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision: archivalTarget.decision,
          reason: archivalReason.trim() || (archivalTarget.decision === 'ARCHIVE' ? 'Konfirmasi pengarsipan dari dasbor' : 'Dokumen dipertahankan aktif'),
        }),
      });
      setArchivalTarget(null);
      setArchivalReason('');
      await loadDashboard();
      onNotificationsChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memproses konfirmasi arsip.');
    } finally {
      setSubmittingArchival(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-5 h-28" />
          ))}
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-6 h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-5 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const canManageOps = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  return (
    <div className="space-y-6">
      {/* Header Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Dasbor Operasional {user.role === 'KAE_SALES' ? 'KAE / Sales' : user.role === 'SPV_SAMPLING' ? 'SPV Sampling' : 'Manajemen'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Ringkasan antrean sampling, ketersediaan tim lapangan, armada, dan status dokumen SPS PT ANKAL.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('requests')}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md transition-colors cursor-pointer"
          >
            <ClipboardList className="w-4 h-4" />
            <span>{user.role === 'KAE_SALES' ? 'Buat Permintaan Sampling' : 'Tinjau Permintaan'}</span>
          </button>
          {canManageOps && (
            <button
              type="button"
              onClick={() => onNavigate('scheduling')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors cursor-pointer"
            >
              <Users className="w-4 h-4" />
              <span>Penjadwalan &amp; Penugasan</span>
            </button>
          )}
        </div>
      </div>

      {/* Role-Specific Metric Grid */}
      {user.role === 'KAE_SALES' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Permintaan Saya"
            value={data.kae.myRequestsCount}
            subtext={`${data.kae.draftCount} Draft · ${data.kae.awaitingApprovalCount} Menunggu`}
            icon={ClipboardList}
            onClick={() => onNavigate('requests')}
          />
          <MetricCard
            label="Perlu Revisi"
            value={data.kae.revisionCount}
            subtext="Dikembalikan oleh SPV Sampling"
            icon={AlertTriangle}
            tone={data.kae.revisionCount > 0 ? 'amber' : 'neutral'}
            onClick={() => onNavigate('requests')}
          />
          <MetricCard
            label="Disetujui & Berjalan"
            value={data.kae.approvedCount}
            subtext={`${data.kae.upcomingSamplingCount} Jadwal mendatang`}
            icon={CheckCircle2}
            tone="green"
            onClick={() => onNavigate('jobs')}
          />
          <MetricCard
            label="Dokumen SPS"
            value={data.kae.activeSpsCount}
            subtext={`${data.kae.archivedSpsCount} Dokumen terarsip`}
            icon={FileText}
            onClick={() => onNavigate('sps')}
          />
        </div>
      )}

      {user.role === 'SPV_SAMPLING' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Antrean Persetujuan"
            value={data.spv.incomingRequestsCount}
            subtext={`${data.spv.awaitingAssignmentCount} Siap ditugaskan`}
            icon={ClipboardList}
            tone={data.spv.incomingRequestsCount > 0 ? 'amber' : 'neutral'}
            onClick={() => onNavigate('requests')}
          />
          <MetricCard
            label="Personel Tersedia"
            value={data.spv.availableInternalCount + data.spv.availableFreelanceCount}
            subtext={`${data.spv.availableInternalCount} Internal · ${data.spv.availableFreelanceCount} Freelance`}
            icon={Users}
            tone="green"
            onClick={() => onNavigate('availability')}
          />
          <MetricCard
            label="Kendaraan & Jadwal"
            value={`${data.spv.availableVehiclesCount}/${data.spv.totalVehiclesCount}`}
            subtext={`${data.spv.upcomingSamplingCount} Jadwal aktif · ${data.spv.conflictCount} Bentrok`}
            icon={Truck}
            tone={data.spv.conflictCount > 0 ? 'red' : 'neutral'}
            onClick={() => onNavigate('vehicles')}
          />
          <MetricCard
            label="Antrean SPS & Arsip"
            value={data.spv.spsAwaitingGenerationCount + data.spv.spsAwaitingArchivalCount}
            subtext={`${data.spv.spsAwaitingGenerationCount} Belum terbit · ${data.spv.spsAwaitingArchivalCount} Konfirmasi arsip`}
            icon={Archive}
            tone={data.spv.spsAwaitingArchivalCount > 0 ? 'amber' : 'neutral'}
            onClick={() => onNavigate('sps')}
          />
        </div>
      )}

      {user.role === 'MANAGEMENT' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Pekerjaan & Permintaan"
            value={data.management.totalJobs}
            subtext={`${data.management.totalRequests} Permintaan tercatat · ${data.management.pendingRequests} Menunggu`}
            icon={ClipboardList}
            onClick={() => onNavigate('jobs')}
          />
          <MetricCard
            label="Utilisasi Personel"
            value={`${data.management.personnelUtilizationPct}%`}
            subtext={`${data.management.internalAssignmentsCount} Internal · ${data.management.freelanceAssignmentsCount} Freelance`}
            icon={Users}
            tone="green"
            onClick={() => onNavigate('gantt')}
          />
          <MetricCard
            label="Utilisasi Kendaraan"
            value={`${data.management.vehicleUtilizationPct}%`}
            subtext={`${data.spv.availableVehiclesCount} Armada siap beroperasi`}
            icon={Truck}
            onClick={() => onNavigate('vehicles')}
          />
          <MetricCard
            label="Pekerjaan Selesai & Arsip"
            value={data.management.completedJobs}
            subtext={`${data.spv.spsAwaitingArchivalCount} SPS menunggu konfirmasi arsip`}
            icon={Archive}
            onClick={() => onNavigate('archive')}
          />
        </div>
      )}

      {/* Post-Schedule SPS Archival Confirmation Banner (Scenario 8) */}
      {canManageOps && data.pendingArchivalSps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Konfirmasi Pengarsipan Dokumen SPS Pasca Jadwal ({data.pendingArchivalSps.length})
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Dokumen SPS berikut telah melewati tanggal pelaksanaan sampling. Pilih untuk memindahkan ke arsip atau tetap aktif.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('sps')}
              className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap cursor-pointer"
            >
              Kelola di Dokumen SPS →
            </button>
          </div>

          <div className="divide-y divide-amber-200/70 bg-white border border-amber-200 rounded-md">
            {data.pendingArchivalSps.map((doc) => (
              <div key={doc.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">{doc.spsNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-800">{doc.customerName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500 tabular-nums">{doc.samplingDateLabel}</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Jadwal pengambilan contoh uji untuk SPS <span className="font-medium">{doc.spsNumber}</span> telah melewati tanggal pelaksanaan. Apakah dokumen ini ingin dipindahkan ke arsip?
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setArchivalReason('');
                      setArchivalTarget({ doc, decision: 'DEFER' });
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                  >
                    TIDAK — PERTAHANKAN AKTIF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setArchivalReason('');
                      setArchivalTarget({ doc, decision: 'ARCHIVE' });
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded whitespace-nowrap cursor-pointer"
                  >
                    YA — ARSIPKAN
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-Column Operational Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Sampling Requests */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Permintaan Sampling Terbaru</h2>
              <p className="text-xs text-slate-500">Pembaruan status permintaan dan pengajuan operasional</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('requests')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] hover:underline cursor-pointer"
            >
              <span>Lihat Semua</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">No. Permintaan</th>
                  <th className="px-4 py-2.5 font-medium">Pelanggan &amp; Pekerjaan</th>
                  <th className="px-4 py-2.5 font-medium">Tgl Usulan</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                      {req.requestNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 text-xs sm:text-sm">{req.customerName}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[260px]">{req.jobName}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateRangeId(req.proposedDate, req.proposedEndDate)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusTag status={req.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upcoming Sampling Schedule */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Jadwal Sampling Mendatang</h2>
              <p className="text-xs text-slate-500">Aktivitas lapangan terjadwal aktif</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('gantt')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] hover:underline cursor-pointer"
            >
              <span>Buka Gantt</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.upcomingSchedules.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Belum ada jadwal sampling mendatang yang terkonfirmasi.
              </div>
            ) : (
              data.upcomingSchedules.map((sch) => (
                <div key={sch.id} className="px-5 py-3.5 flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <CalendarClock className="w-3.5 h-3.5 text-[#25AC43]" />
                      <span>{formatDateRangeId(sch.startDate, sch.endDate)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{sch.scheduleCode}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-900">{sch.activityName}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Archival Decision Modal */}
      <ModalDialog
        open={Boolean(archivalTarget)}
        onClose={() => setArchivalTarget(null)}
        title={
          archivalTarget?.decision === 'ARCHIVE'
            ? 'Konfirmasi Pengarsipan Dokumen SPS'
            : 'Pertahankan Dokumen SPS Tetap Aktif'
        }
        subtitle={archivalTarget ? `${archivalTarget.doc.spsNumber} · ${archivalTarget.doc.customerName}` : ''}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleArchivalSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">
            {archivalTarget?.decision === 'ARCHIVE'
              ? 'Dokumen akan dipindahkan ke Arsip Dokumen dengan seluruh riwayat revisi dan PDF tetap tersimpan permanen.'
              : 'Status dokumen akan diubah menjadi Pengarsipan Ditunda dan tetap berada di daftar Dokumen SPS Aktif.'}
          </p>
          <div>
            <label htmlFor="dash-archival-reason" className="block text-xs font-medium text-slate-700 mb-1">
              Catatan / Alasan Keputusan
            </label>
            <textarea
              id="dash-archival-reason"
              rows={3}
              value={archivalReason}
              onChange={(e) => setArchivalReason(e.target.value)}
              placeholder="Contoh: Pekerjaan lapangan telah selesai atau dijadwalkan ulang ke minggu depan"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setArchivalTarget(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submittingArchival}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submittingArchival ? 'Menyimpan...' : 'Konfirmasi Keputusan'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: string | number;
  subtext: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
  onClick?: () => void;
}) {
  const iconColors: Record<string, string> = {
    neutral: 'text-slate-600 bg-slate-100',
    green: 'text-[#166534] bg-[#dcfce7]',
    amber: 'text-amber-700 bg-amber-100',
    red: 'text-red-700 bg-red-100',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-300 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</p>
        </div>
        <div className={`p-2 rounded-md ${iconColors[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-2 truncate tabular-nums">{subtext}</p>
    </button>
  );
}
