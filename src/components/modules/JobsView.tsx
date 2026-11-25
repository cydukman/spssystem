import React, { useEffect, useState } from 'react';
import { Play, CheckCircle2, FileText, Users, Truck, Download } from 'lucide-react';
import { apiFetch, openAuthenticatedPdf } from '../../lib/api';
import type { AppUser, PersonnelRecord, SamplingRequest } from '../../types/ankal';
import { EmptyState, SkeletonTable, StatusTag, formatDateRangeId } from '../ui/Common';

export function JobsView({
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ACTIVE_OPS');

  const loadData = async () => {
    setLoading(true);
    try {
      const [reqs, pers] = await Promise.all([
        apiFetch<SamplingRequest[]>('/api/requests'),
        apiFetch<PersonnelRecord[]>('/api/personnel'),
      ]);
      setRequests(reqs);
      setPersonnelList(pers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat manajemen pekerjaan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const canManageOps = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const jobs = requests.filter((r) => {
    if (statusFilter === 'ACTIVE_OPS') {
      return ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status);
    }
    return r.status === statusFilter;
  });

  const handleUpdateStatus = async (requestId: string, status: 'IN_PROGRESS' | 'COMPLETED') => {
    setError(null);
    try {
      await apiFetch(`/api/jobs/${requestId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          notes: status === 'IN_PROGRESS' ? 'Tim berangkat melaksanakan sampling lapangan' : 'Pelaksanaan sampling selesai',
        }),
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui status pekerjaan.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manajemen Pekerjaan</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pemantauan eksekusi pekerjaan lapangan dari tahap disetujui, penugasan, penerbitan SPS hingga selesai.
          </p>
        </div>
        <select
          aria-label="Filter tahap pekerjaan"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="ACTIVE_OPS">Semua Tahap Operasional</option>
          <option value="APPROVED">Disetujui (Belum Dijadwalkan)</option>
          <option value="ASSIGNED">Personel Ditugaskan</option>
          <option value="SCHEDULED">Terjadwal</option>
          <option value="IN_PROGRESS">Sedang Berjalan</option>
          <option value="COMPLETED">Selesai</option>
        </select>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>
      )}

      {loading ? (
        <SkeletonTable rows={5} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="Tidak ada pekerjaan di tahap ini"
          description="Pekerjaan akan muncul di sini setelah permintaan sampling disetujui oleh SPV Sampling."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Pekerjaan &amp; Pelanggan</th>
                  <th className="px-4 py-3 font-medium">Jadwal Aktif</th>
                  <th className="px-4 py-3 font-medium">Tim Ditugaskan</th>
                  <th className="px-4 py-3 font-medium">SPS</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Kontrol Eksekusi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => {
                  const activeSch = job.schedules.find((s) => s.isActive);
                  const teamNames = job.assignments
                    .map((a) => personnelList.find((p) => p.id === a.personnelId)?.fullName)
                    .filter(Boolean);

                  return (
                    <tr key={job.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-xs text-slate-500 tabular-nums">{job.requestNumber}</div>
                        <div className="font-semibold text-slate-900">{job.customerName}</div>
                        <div className="text-xs text-slate-600">{job.jobName}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        <div>
                          {formatDateRangeId(
                            activeSch ? activeSch.startDate : job.proposedDate,
                            activeSch ? activeSch.endDate : job.proposedEndDate
                          )}
                        </div>
                        <div className="text-slate-500">{job.samplingLocation}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-700">
                        {teamNames.length > 0 ? (
                          <div>{teamNames.join(', ')}</div>
                        ) : (
                          <span className="text-slate-400">Belum ada tim</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        {job.spsDocument ? (
                          <span className="font-mono font-medium text-slate-900 tabular-nums">
                            {job.spsDocument.spsNumber}
                          </span>
                        ) : (
                          <span className="text-slate-400">Belum terbit</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusTag status={job.status} />
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          {canManageOps && (job.status === 'APPROVED' || job.assignments.length === 0) && (
                            <button
                              type="button"
                              onClick={() => onNavigate('scheduling')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer"
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>Tugaskan Tim</span>
                            </button>
                          )}
                          {canManageOps && job.vehicleReservations.length === 0 && (
                            <button
                              type="button"
                              onClick={() => onNavigate('vehicles')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              <span>Kendaraan</span>
                            </button>
                          )}
                          {job.spsDocument && (
                            <button
                              type="button"
                              onClick={() => openAuthenticatedPdf(`/api/sps/${job.spsDocument!.id}/pdf`, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Unduh SPS</span>
                            </button>
                          )}
                          {canManageOps && !job.spsDocument && job.assignments.length > 0 && (
                            <button
                              type="button"
                              onClick={() => onNavigate('sps')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#166534] bg-[#f0fdf4] border border-[#25AC43]/40 rounded hover:bg-[#dcfce7] cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Terbitkan SPS</span>
                            </button>
                          )}
                          {canManageOps && (job.status === 'SCHEDULED' || job.status === 'ASSIGNED') && (
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(job.id, 'IN_PROGRESS')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Mulai Lapangan</span>
                            </button>
                          )}
                          {canManageOps && job.status === 'IN_PROGRESS' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateStatus(job.id, 'COMPLETED')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Selesaikan</span>
                            </button>
                          )}
                        </div>
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
  );
}
