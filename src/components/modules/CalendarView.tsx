import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { SamplingRequest } from '../../types/ankal';
import { SkeletonTable, StatusTag } from '../ui/Common';

interface AvailItem {
  personnel: {
    id: string;
    code: string;
    fullName: string;
    category: 'INTERNAL' | 'EXTERNAL';
    baseLocation: string;
  };
  evaluation: {
    status: string;
    reasons: string[];
  };
}

export function CalendarView() {
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);

  const [lookupStart, setLookupStart] = useState(() => `${new Date().toISOString().slice(0, 10)}T08:00`);
  const [lookupEnd, setLookupEnd] = useState(() => `${new Date().toISOString().slice(0, 10)}T17:00`);
  const [availablePersonnel, setAvailablePersonnel] = useState<AvailItem[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const reqs = await apiFetch<SamplingRequest[]>('/api/requests');
      setRequests(reqs);
    } finally {
      setLoading(false);
    }
  };

  const runAvailabilityLookup = async () => {
    setLookupLoading(true);
    try {
      const qs = new URLSearchParams({
        start: new Date(lookupStart).toISOString(),
        end: new Date(lookupEnd).toISOString(),
      });
      const res = await apiFetch<{ personnelAvailability: AvailItem[] }>(`/api/availability?${qs.toString()}`);
      setAvailablePersonnel(res.personnelAvailability);
    } finally {
      setLookupLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
    runAvailabilityLookup();
  }, []);

  const daysGrid = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
    const cells: Array<{ date: Date | null }> = [];

    for (let i = 0; i < startOffset; i++) cells.push({ date: null });
    for (let day = 1; day <= lastDay.getDate(); day++) {
      cells.push({ date: new Date(year, month, day) });
    }
    return cells;
  }, [monthAnchor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, SamplingRequest[]>();
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    for (const r of requests) {
      if (r.status === 'REJECTED' || r.status === 'CANCELLED') continue;
      const activeSch = r.schedules.find((s) => s.isActive);
      const rawStart = new Date(activeSch ? activeSch.startDate : r.proposedDate);
      const rawEnd = new Date(
        activeSch ? activeSch.endDate : r.proposedEndDate || r.proposedDate
      );
      const startDay = new Date(rawStart.getFullYear(), rawStart.getMonth(), rawStart.getDate());
      const endDay =
        !Number.isNaN(rawEnd.getTime()) && rawEnd.getTime() >= startDay.getTime()
          ? new Date(rawEnd.getFullYear(), rawEnd.getMonth(), rawEnd.getDate())
          : startDay;

      const cur = new Date(Math.max(startDay.getTime(), monthStart.getTime()));
      const limit = new Date(Math.min(endDay.getTime(), monthEnd.getTime()));
      while (cur.getTime() <= limit.getTime()) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        const list = map.get(key) || [];
        list.push(r);
        map.set(key, list);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [requests, monthAnchor]);

  if (loading) return <SkeletonTable rows={6} />;

  const monthLabel = monthAnchor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const readyList = availablePersonnel.filter((x) => x.evaluation.status === 'AVAILABLE');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Kalender Operasional &amp; Ketersediaan</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pantau jadwal pengambilan contoh uji bulanan sekaligus periksa personel yang bebas tugas pada tanggal tertentu.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 bg-white border border-slate-300 rounded-md px-3 py-1.5">
          <button
            type="button"
            aria-label="Bulan sebelumnya"
            onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            className="p-1 hover:bg-slate-100 rounded cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-900 min-w-[140px] text-center capitalize">
            {monthLabel}
          </span>
          <button
            type="button"
            aria-label="Bulan berikutnya"
            onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            className="p-1 hover:bg-slate-100 rounded cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Monthly Grid */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 text-center">
            {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => (
              <div key={d} className="py-2.5 border-r border-slate-200 last:border-r-0">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {daysGrid.map((cell, idx) => {
              if (!cell.date) {
                return <div key={idx} className="min-h-[104px] bg-slate-50/50 border-r border-b border-slate-100" />;
              }
              const key = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(
                cell.date.getDate()
              ).padStart(2, '0')}`;
              const dayEvents = eventsByDay.get(key) || [];
              const isToday = new Date().toDateString() === cell.date.toDateString();

              return (
                <div
                  key={idx}
                  className={`min-h-[104px] p-2 border-r border-b border-slate-100 space-y-1 ${
                    isToday ? 'bg-[#f0fdf4]/60' : 'bg-white'
                  }`}
                >
                  <div className={`text-xs font-semibold tabular-nums ${isToday ? 'text-[#166534]' : 'text-slate-700'}`}>
                    {cell.date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        title={`${ev.customerName} — ${ev.jobName} (${ev.status})`}
                        className={`px-1.5 py-1 rounded text-[10px] font-medium truncate ${
                          ev.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ev.status === 'SCHEDULED' || ev.status === 'IN_PROGRESS'
                            ? 'bg-[#25AC43] text-white'
                            : 'bg-blue-50 text-blue-800 border border-blue-200'
                        }`}
                      >
                        {ev.customerName}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-slate-500 font-medium">+{dayEvents.length - 3} lainnya</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Date-Range Available Personnel Finder */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#25AC43]" />
            <h2 className="text-sm font-semibold text-slate-900">Cari Personel Tersedia</h2>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Dari Tanggal &amp; Jam</label>
              <input
                type="datetime-local"
                value={lookupStart}
                onChange={(e) => setLookupStart(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Sampai Tanggal &amp; Jam</label>
              <input
                type="datetime-local"
                value={lookupEnd}
                onChange={(e) => setLookupEnd(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded"
              />
            </div>
            <button
              type="button"
              onClick={runAvailabilityLookup}
              disabled={lookupLoading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{lookupLoading ? 'Memeriksa...' : 'Cek Ketersediaan'}</span>
            </button>
          </div>

          <div className="pt-2 border-t border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-700 tabular-nums">
              Personel Siap Tugas ({readyList.length} / {availablePersonnel.length})
            </div>
            <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-100">
              {availablePersonnel.map(({ personnel: p, evaluation }) => (
                <div key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-900">{p.fullName}</div>
                    <div className="text-[11px] text-slate-500">
                      {p.code} · {p.category === 'INTERNAL' ? 'Internal' : 'Freelance'}
                    </div>
                  </div>
                  <StatusTag status={evaluation.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
