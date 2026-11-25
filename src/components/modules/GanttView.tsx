import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, AlertCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser, Department, PersonnelRecord, SamplingRequest } from '../../types/ankal';
import { ModalDialog, SkeletonTable, StatusTag, formatDateTimeId } from '../ui/Common';

interface AssignmentRow {
  id: string;
  scheduleId: string;
  requestId: string;
  personnelId: string;
  roleInTeam: string;
  assignmentStatus: string;
  assignmentMode: string;
  startDate: string;
  endDate: string;
  notes: string;
  personnel: PersonnelRecord | null;
  request: SamplingRequest | null;
}

interface LeaveRow {
  id: string;
  personnelId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string;
}

export function GanttView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const [personnelList, setPersonnelList] = useState<PersonnelRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [catFilter, setCatFilter] = useState<'ALL' | 'INTERNAL' | 'EXTERNAL'>('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentRow | null>(null);
  const [replaceId, setReplaceId] = useState('');
  const [replaceReason, setReplaceReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [pers, assigns, avail, master] = await Promise.all([
        apiFetch<PersonnelRecord[]>('/api/personnel'),
        apiFetch<AssignmentRow[]>('/api/assignments'),
        apiFetch<{ leaveRequests: LeaveRow[] }>('/api/availability'),
        apiFetch<{ departments: Department[] }>('/api/master'),
      ]);
      setPersonnelList(pers);
      setAssignments(assigns.filter((a) => a.assignmentStatus !== 'REPLACED' && a.assignmentStatus !== 'CANCELLED'));
      setLeaves(avail.leaveRequests || []);
      setDepartments(master.departments);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat Gantt Chart.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const { rangeStart, rangeEnd, columns } = useMemo(() => {
    const start = new Date(anchorDate);
    start.setHours(0, 0, 0, 0);
    let days = 7;
    if (viewMode === 'DAILY') days = 1;
    if (viewMode === 'WEEKLY') days = 7;
    if (viewMode === 'MONTHLY') days = 14;

    const end = new Date(start.getTime() + days * 86400000);
    const cols: Array<{ label: string; sub: string; start: Date; end: Date }> = [];

    if (viewMode === 'DAILY') {
      for (let h = 6; h < 22; h += 2) {
        const cs = new Date(start);
        cs.setHours(h, 0, 0, 0);
        const ce = new Date(start);
        ce.setHours(h + 2, 0, 0, 0);
        cols.push({
          label: `${String(h).padStart(2, '0')}:00`,
          sub: 'WIB',
          start: cs,
          end: ce,
        });
      }
    } else {
      for (let d = 0; d < days; d++) {
        const cs = new Date(start.getTime() + d * 86400000);
        const ce = new Date(cs.getTime() + 86400000);
        cols.push({
          label: cs.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
          sub: cs.toLocaleDateString('id-ID', { weekday: 'short' }),
          start: cs,
          end: ce,
        });
      }
    }

    return { rangeStart: viewMode === 'DAILY' ? cols[0].start : start, rangeEnd: viewMode === 'DAILY' ? cols[cols.length - 1].end : end, columns: cols };
  }, [anchorDate, viewMode]);

  const filteredPersonnel = useMemo(() => {
    return personnelList.filter((p) => {
      if (deptFilter !== 'ALL' && p.departmentId !== deptFilter) return false;
      if (catFilter !== 'ALL' && p.category !== catFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.fullName.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [personnelList, deptFilter, catFilter, search]);

  const shiftRange = (dir: -1 | 1) => {
    const stepDays = viewMode === 'DAILY' ? 1 : viewMode === 'WEEKLY' ? 7 : 14;
    setAnchorDate((prev) => new Date(prev.getTime() + dir * stepDays * 86400000));
  };

  const handleReplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment || !replaceId) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/assignments/${selectedAssignment.id}/replace`, {
        method: 'POST',
        body: JSON.stringify({ newPersonnelId: replaceId, reason: replaceReason }),
      });
      setSelectedAssignment(null);
      setReplaceId('');
      setReplaceReason('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengganti personel pada jadwal.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <SkeletonTable rows={7} />;

  const totalSpanMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gantt Chart Penugasan Personel</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Visualisasi lini masa jadwal personel internal dan freelance, cuti, status tentatif, dan deteksi bentrok.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-300 bg-white overflow-hidden">
            {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  viewMode === m ? 'bg-[#25AC43] text-white' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {m === 'DAILY' ? 'Harian' : m === 'WEEKLY' ? 'Mingguan' : '2 Mingguan / Bulanan'}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded-md px-2 py-1">
            <button
              type="button"
              aria-label="Periode sebelumnya"
              onClick={() => shiftRange(-1)}
              className="p-1 text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                d.setHours(0, 0, 0, 0);
                setAnchorDate(d);
              }}
              className="px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
            >
              Hari Ini
            </button>
            <button
              type="button"
              aria-label="Periode berikutnya"
              onClick={() => shiftRange(1)}
              className="p-1 text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters & Legend */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari personel..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
            />
          </div>
          <select
            aria-label="Filter departemen"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="ALL">Semua Departemen</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter kategori"
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value as typeof catFilter)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="ALL">Internal &amp; Freelance</option>
            <option value="INTERNAL">Karyawan Internal</option>
            <option value="EXTERNAL">Freelance / Eksternal</option>
          </select>
          <select
            aria-label="Filter status penugasan"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="ALL">Semua Status Jadwal</option>
            <option value="CONFIRMED">Terkonfirmasi</option>
            <option value="TENTATIVE">Tentatif</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-[#25AC43] inline-block" />
            <span>Terkonfirmasi</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-400 inline-block" />
            <span>Tentatif</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-400 inline-block" />
            <span>Cuti / Izin</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-500 inline-block" />
            <span>Bentrok Jadwal</span>
          </div>
        </div>
      </div>

      {/* Gantt Grid */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="min-w-[920px]">
          {/* Timeline Header */}
          <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-xs">
            <div className="col-span-3 px-4 py-2.5 font-semibold text-slate-700 border-r border-slate-200">
              Personel ({filteredPersonnel.length})
            </div>
            <div className="col-span-9 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
              {columns.map((c, idx) => (
                <div
                  key={idx}
                  className="px-2 py-2 text-center border-r border-slate-200 last:border-r-0 tabular-nums"
                >
                  <div className="font-semibold text-slate-800">{c.label}</div>
                  <div className="text-[10px] text-slate-500">{c.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Personnel Rows */}
          <div className="divide-y divide-slate-100">
            {filteredPersonnel.map((person) => {
              const pAssigns = assignments.filter((a) => {
                if (a.personnelId !== person.id) return false;
                if (statusFilter !== 'ALL' && a.assignmentStatus !== statusFilter) return false;
                const s = new Date(a.startDate).getTime();
                const e = new Date(a.endDate).getTime();
                return s < rangeEnd.getTime() && e > rangeStart.getTime();
              });

              const pLeaves = leaves.filter((l) => {
                if (l.personnelId !== person.id || l.status !== 'APPROVED') return false;
                const s = new Date(l.startDate).getTime();
                const e = new Date(l.endDate).getTime();
                return s < rangeEnd.getTime() && e > rangeStart.getTime();
              });

              return (
                <div key={person.id} className="grid grid-cols-12 items-stretch min-h-[56px]">
                  <div className="col-span-3 px-4 py-2.5 border-r border-slate-200 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">{person.code}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                        {person.category === 'INTERNAL' ? 'Int' : 'Ext'}
                      </span>
                    </div>
                    <div className="font-medium text-xs text-slate-900 truncate">{person.fullName}</div>
                  </div>

                  <div className="col-span-9 relative py-2">
                    {/* Vertical Gridlines */}
                    <div
                      className="absolute inset-0 grid pointer-events-none"
                      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                    >
                      {columns.map((_, idx) => (
                        <div key={idx} className="border-r border-slate-100 last:border-r-0 h-full" />
                      ))}
                    </div>

                    {/* Leave Bars */}
                    {pLeaves.map((lv) => {
                      const s = Math.max(rangeStart.getTime(), new Date(lv.startDate).getTime());
                      const e = Math.min(rangeEnd.getTime(), new Date(lv.endDate).getTime());
                      const leftPct = ((s - rangeStart.getTime()) / totalSpanMs) * 100;
                      const widthPct = Math.max(4, ((e - s) / totalSpanMs) * 100);
                      return (
                        <div
                          key={lv.id}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`Cuti/Izin: ${lv.leaveType} (${lv.reason})`}
                          className="relative z-10 h-6 mb-1 rounded bg-slate-400 text-white text-[10px] font-medium px-2 flex items-center truncate"
                        >
                          Cuti: {lv.leaveType}
                        </div>
                      );
                    })}

                    {/* Assignment Bars */}
                    {pAssigns.map((asgn, i) => {
                      const s = Math.max(rangeStart.getTime(), new Date(asgn.startDate).getTime());
                      const e = Math.min(rangeEnd.getTime(), new Date(asgn.endDate).getTime());
                      const leftPct = ((s - rangeStart.getTime()) / totalSpanMs) * 100;
                      const widthPct = Math.max(6, ((e - s) / totalSpanMs) * 100);

                      const hasOverlap = pAssigns.some(
                        (other, j) =>
                          i !== j &&
                          new Date(asgn.startDate).getTime() < new Date(other.endDate).getTime() &&
                          new Date(other.startDate).getTime() < new Date(asgn.endDate).getTime()
                      );

                      const barColor = hasOverlap
                        ? 'bg-red-600 hover:bg-red-700'
                        : asgn.assignmentStatus === 'TENTATIVE'
                        ? 'bg-amber-500 hover:bg-amber-600'
                        : 'bg-[#25AC43] hover:bg-[#1e8e36]';

                      return (
                        <button
                          key={asgn.id}
                          type="button"
                          onClick={() => {
                            setSelectedAssignment(asgn);
                            setReplaceId('');
                            setReplaceReason('');
                          }}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${asgn.request?.customerName || 'Sampling'} — ${asgn.request?.jobName || ''}`}
                          className={`relative z-10 h-7 mb-1 rounded text-white text-[11px] font-medium px-2 flex items-center truncate cursor-pointer transition-colors ${barColor}`}
                        >
                          <span className="truncate">
                            {asgn.request?.customerName || 'Tugas'} · {asgn.roleInTeam === 'TEAM_LEADER' ? 'Ketua' : 'Petugas'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bar Detail & Quick Replace Modal */}
      <ModalDialog
        open={Boolean(selectedAssignment)}
        onClose={() => setSelectedAssignment(null)}
        title="Detail Penugasan pada Gantt"
        subtitle={
          selectedAssignment
            ? `${selectedAssignment.personnel?.fullName || ''} · ${selectedAssignment.request?.customerName || ''}`
            : ''
        }
        maxWidth="max-w-lg"
      >
        {selectedAssignment && (
          <div className="space-y-4 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-500">{selectedAssignment.request?.requestNumber}</span>
                <StatusTag status={selectedAssignment.assignmentStatus} />
              </div>
              <div className="font-semibold text-sm text-slate-900">
                {selectedAssignment.request?.jobName}
              </div>
              <div className="text-slate-600">
                Waktu: <span className="tabular-nums font-medium">{formatDateTimeId(selectedAssignment.startDate)}</span> s.d.{' '}
                <span className="tabular-nums font-medium">{formatDateTimeId(selectedAssignment.endDate)}</span>
              </div>
              <div className="text-slate-600">Lokasi: {selectedAssignment.request?.samplingLocation}</div>
            </div>

            {canManage && (
              <form onSubmit={handleReplace} className="space-y-3 pt-2 border-t border-slate-200">
                <div className="font-semibold text-slate-800">Ganti Personel pada Jadwal Ini</div>
                <select
                  required
                  value={replaceId}
                  onChange={(e) => setReplaceId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                >
                  <option value="">-- Pilih Personel Pengganti --</option>
                  {personnelList
                    .filter((p) => p.fieldEligible && p.id !== selectedAssignment.personnelId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.fullName} ({p.category === 'INTERNAL' ? 'Internal' : 'Freelance'})
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  required
                  value={replaceReason}
                  onChange={(e) => setReplaceReason(e.target.value)}
                  placeholder="Alasan penggantian personel..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedAssignment(null)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
                  >
                    Tutup
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded disabled:opacity-60"
                  >
                    {submitting ? 'Memproses...' : 'Konfirmasi Penggantian'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
