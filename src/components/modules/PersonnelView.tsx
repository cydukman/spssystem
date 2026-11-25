import React, { useEffect, useState } from 'react';
import { Plus, ShieldCheck, ShieldAlert, Search, Award } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser, Competency, Department, PersonnelRecord } from '../../types/ankal';
import { EmptyState, ModalDialog, SkeletonTable, StatusTag, formatDateId } from '../ui/Common';

export function PersonnelView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const [list, setList] = useState<PersonnelRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'INTERNAL' | 'EXTERNAL'>('ALL');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: '',
    category: 'EXTERNAL' as 'INTERNAL' | 'EXTERNAL',
    fullName: '',
    departmentId: '',
    position: 'Freelance Field Sampler',
    phone: '',
    email: '',
    baseLocation: 'Bekasi',
    fieldEligible: false,
    notes: '',
    competencyIds: [] as string[],
  });

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [pers, master] = await Promise.all([
        apiFetch<PersonnelRecord[]>('/api/personnel'),
        apiFetch<{ departments: Department[]; competencies: Competency[] }>('/api/master'),
      ]);
      setList(pers);
      setDepartments(master.departments);
      setCompetencies(master.competencies);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data personel.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filtered = list.filter((p) => {
    if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.fullName.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.position.toLowerCase().includes(q) ||
        p.baseLocation.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleToggleVerify = async (person: PersonnelRecord) => {
    setError(null);
    try {
      await apiFetch(`/api/personnel/${person.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ fieldEligible: !person.fieldEligible }),
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status verifikasi.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/personnel', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          departmentId: form.departmentId || null,
        }),
      });
      setCreateOpen(false);
      setForm({
        code: '',
        category: 'EXTERNAL',
        fullName: '',
        departmentId: '',
        position: 'Freelance Field Sampler',
        phone: '',
        email: '',
        baseLocation: 'Bekasi',
        fieldEligible: false,
        notes: '',
        competencyIds: [],
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menambah personel baru.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manajemen Personel</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Direktori karyawan internal dan tenaga freelance/eksternal beserta kompetensi matriks serta verifikasi kelayakan lapangan.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Personel / Freelance</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">{error}</div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama personel, kode, jabatan, atau lokasi base..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(['ALL', 'INTERNAL', 'EXTERNAL'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-[#25AC43] text-white border-[#25AC43]'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {cat === 'ALL' ? 'Semua' : cat === 'INTERNAL' ? 'Internal' : 'Freelance / Eksternal'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Personel tidak ditemukan"
          description="Sesuaikan kata kunci pencarian atau tambahkan personel internal/freelance baru."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Personel &amp; Kategori</th>
                  <th className="px-4 py-3 font-medium">Departemen &amp; Base</th>
                  <th className="px-4 py-3 font-medium">Kompetensi &amp; Sertifikasi</th>
                  <th className="px-4 py-3 font-medium">Kelayakan Lapangan</th>
                  {canManage && <th className="px-4 py-3 font-medium text-right">Verifikasi SPV</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500 tabular-nums">{p.code}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-xs font-semibold text-slate-700">
                          {p.category === 'INTERNAL' ? 'Internal' : 'Freelance'}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900 mt-0.5">{p.fullName}</div>
                      <div className="text-xs text-slate-500">{p.position} · {p.phone}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-700">
                      <div className="font-medium">{p.department?.name || 'Eksternal / Independen'}</div>
                      <div className="text-slate-500 mt-0.5">Base: {p.baseLocation}</div>
                      <div className="mt-1"><StatusTag status={p.employmentStatus} /></div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      <div className="space-y-1">
                        {p.competencies.length > 0 ? (
                          p.competencies.map((c) => (
                            <div key={c.id} className="flex items-center gap-1.5 text-slate-700">
                              <Award className="w-3.5 h-3.5 text-[#25AC43] shrink-0" />
                              <span>{c.competency?.name || c.competencyId}</span>
                            </div>
                          ))
                        ) : (
                          <span className="text-slate-400">Belum ada kompetensi</span>
                        )}
                        {p.certifications.length > 0 && (
                          <div className="text-[11px] text-slate-500 pt-1">
                            Sertifikat: {p.certifications.map((ct) => `${ct.name} (s.d. ${formatDateId(ct.validUntil)})`).join(', ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      {p.fieldEligible ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Terverifikasi Layak</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 font-medium">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Belum Terverifikasi</span>
                        </div>
                      )}
                      {p.verifiedAt && (
                        <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                          Verifikasi: {formatDateId(p.verifiedAt)}
                        </div>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 align-top text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleVerify(p)}
                          className={`px-3 py-1.5 text-xs font-medium rounded border cursor-pointer ${
                            p.fieldEligible
                              ? 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
                              : 'text-white bg-[#25AC43] border-[#25AC43] hover:bg-[#1e8e36]'
                          }`}
                        >
                          {p.fieldEligible ? 'Cabut Kelayakan' : 'Verifikasi Layak Tugas'}
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

      {/* Add Personnel Modal */}
      <ModalDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Personel Internal / Freelance"
        subtitle="Personel baru dengan status belum terverifikasi tidak akan direkomendasikan sebelum diverifikasi SPV."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kode Personel *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="Mis. EXT-010 atau EMP-020"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kategori *</label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as 'INTERNAL' | 'EXTERNAL',
                    fieldEligible: e.target.value === 'INTERNAL',
                  })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="EXTERNAL">Freelance / Kontraktor Eksternal</option>
                <option value="INTERNAL">Karyawan Internal</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap *</label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jabatan / Peran *</label>
              <input
                type="text"
                required
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Departemen</label>
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">-- Tidak terikat departemen --</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. Telepon / WhatsApp *</label>
              <input
                type="text"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Lokasi Base *</label>
              <input
                type="text"
                required
                value={form.baseLocation}
                onChange={(e) => setForm({ ...form, baseLocation: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">Kompetensi Teknis</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 rounded-md p-3 max-h-40 overflow-y-auto">
              {competencies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.competencyIds.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, competencyIds: [...form.competencyIds, c.id] });
                      } else {
                        setForm({
                          ...form,
                          competencyIds: form.competencyIds.filter((id) => id !== c.id),
                        });
                      }
                    }}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-800">
            <input
              type="checkbox"
              checked={form.fieldEligible}
              onChange={(e) => setForm({ ...form, fieldEligible: e.target.checked })}
            />
            <span>Langsung verifikasi layak tugas lapangan (Field Eligible)</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Personel'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
