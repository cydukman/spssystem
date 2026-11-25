import React, { useEffect, useState } from 'react';
import { RefreshCw, Save, Users, Settings, UserPlus, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppRole, AppUser, ApprovalStatus } from '../../types/ankal';
import { ModalDialog, SkeletonTable, StatusTag, formatDateId } from '../ui/Common';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  approvalStatus: ApprovalStatus;
  isActive: boolean;
  createdAt: string;
}

interface SettingRow {
  id: string;
  key: string;
  value: Record<string, unknown>;
  updatedAt: string;
}

export function UsersSettingsView({
  mode,
  user,
  onChanged,
}: {
  mode: 'users' | 'settings';
  user: AppUser;
  onChanged: () => void;
}) {
  const [usersList, setUsersList] = useState<UserRow[]>([]);
  const [pendingRoles, setPendingRoles] = useState<Record<string, AppRole>>({});
  const [preapproveOpen, setPreapproveOpen] = useState(false);
  const [preapproveForm, setPreapproveForm] = useState({
    email: '',
    fullName: '',
    role: 'KAE_SALES' as AppRole,
    password: '',
  });

  const [spsPattern, setSpsPattern] = useState('{SEQ}/SPS/AKL/{ROMAN_MONTH}/{YEAR}');
  const [nextSequence, setNextSequence] = useState(31);
  const [deferDays, setDeferDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'users') {
        const rows = await apiFetch<UserRow[]>('/api/users');
        setUsersList(rows);
        const roleMap: Record<string, AppRole> = {};
        for (const r of rows) {
          roleMap[r.id] = r.role;
        }
        setPendingRoles(roleMap);
      } else {
        const rows = await apiFetch<SettingRow[]>('/api/settings');
        const spsSet = rows.find((r) => r.key === 'sps_number_format');
        if (spsSet?.value) {
          setSpsPattern(String(spsSet.value.pattern || '{SEQ}/SPS/AKL/{ROMAN_MONTH}/{YEAR}'));
          setNextSequence(Number(spsSet.value.nextSequence || 31));
        }
        const archSet = rows.find((r) => r.key === 'archival_policy');
        if (archSet?.value) {
          setDeferDays(Number(archSet.value.deferIntervalDays || 7));
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat konfigurasi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const handleUpdateUser = async (
    id: string,
    patch: { role?: AppRole; isActive?: boolean; approvalStatus?: ApprovalStatus }
  ) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setSuccessMsg('Perubahan hak akses pengguna disimpan.');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui pengguna.');
    }
  };

  const handleApprovalDecision = async (userId: string, decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/users/${userId}/approval`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          role: pendingRoles[userId] || 'KAE_SALES',
        }),
      });
      setSuccessMsg(
        decision === 'APPROVED'
          ? 'Registrasi pengguna disetujui dan akun sekarang dapat masuk ke sistem.'
          : 'Permintaan registrasi pengguna telah ditolak.'
      );
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memproses persetujuan pengguna.');
    }
  };

  const handlePreapproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch('/api/users/preapprove', {
        method: 'POST',
        body: JSON.stringify(preapproveForm),
      });
      setPreapproveOpen(false);
      setPreapproveForm({ email: '', fullName: '', role: 'KAE_SALES', password: '' });
      setSuccessMsg('Email pengguna berhasil didaftarkan & disetujui oleh Master Admin.');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mendaftarkan email pengguna.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      await Promise.all([
        apiFetch('/api/settings/sps_number_format', {
          method: 'PUT',
          body: JSON.stringify({
            value: { pattern: spsPattern, nextSequence: Number(nextSequence) },
          }),
        }),
        apiFetch('/api/settings/archival_policy', {
          method: 'PUT',
          body: JSON.stringify({
            value: { requireManualConfirmation: true, deferIntervalDays: Number(deferDays) },
          }),
        }),
      ]);
      setSuccessMsg('Pengaturan penomoran SPS dan kebijakan arsip berhasil disimpan.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.');
    }
  };

  const handleResetDemo = async () => {
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch('/api/settings/reset-demo', { method: 'POST' });
      setSuccessMsg('Data demonstrasi ANKAL berhasil disegarkan tanpa menghapus SPS historis yang sudah diimpor.');
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mereset data demo.');
    }
  };

  if (loading) return <SkeletonTable rows={5} />;

  if (mode === 'users') {
    const isSuperadmin = user.role === 'MANAGEMENT';
    const canManageUsers = user.role === 'MANAGEMENT';
    const pendingUsers = usersList.filter((u) => u.approvalStatus === 'PENDING');

    return (
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Users className="w-6 h-6 text-[#25AC43]" />
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manajemen Pengguna &amp; Persetujuan Registrasi</h1>
              <p className="text-sm text-slate-500">
                Setiap pendaftar baru memerlukan persetujuan Master Admin sebelum dapat masuk ke sistem PT ANKAL.
              </p>
            </div>
          </div>
          {canManageUsers && (
            <button
              type="button"
              onClick={() => setPreapproveOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Daftarkan / Setujui Email Baru</span>
            </button>
          )}
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
        {successMsg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">{successMsg}</div>}

        {/* Pending Registration Queue */}
        {pendingUsers.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Antrean Persetujuan Registrasi Baru ({pendingUsers.length})
              </h2>
            </div>
            <div className="divide-y divide-amber-200/70 bg-white border border-amber-200 rounded-md">
              {pendingUsers.map((pu) => (
                <div
                  key={pu.id}
                  className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{pu.fullName}</div>
                    <div className="text-xs text-slate-600">
                      {pu.email} · Mendaftar {formatDateId(pu.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Tetapkan peran untuk ${pu.email}`}
                      value={pendingRoles[pu.id] || pu.role}
                      onChange={(e) =>
                        setPendingRoles((prev) => ({ ...prev, [pu.id]: e.target.value as AppRole }))
                      }
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value="KAE_SALES">KAE / Sales</option>
                      <option value="SPV_SAMPLING">SPV Sampling</option>
                      {isSuperadmin && <option value="MANAGEMENT">Superadmin / Management</option>}
                    </select>
                    <button
                      type="button"
                      disabled={!canManageUsers}
                      onClick={() => handleApprovalDecision(pu.id, 'REJECTED')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Tolak</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canManageUsers}
                      onClick={() => handleApprovalDecision(pu.id, 'APPROVED')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Setujui Akses</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nama &amp; Email</th>
                  <th className="px-4 py-3 font-medium">Persetujuan Admin</th>
                  <th className="px-4 py-3 font-medium">Peran Aplikasi</th>
                  <th className="px-4 py-3 font-medium">Status Akun</th>
                  <th className="px-4 py-3 font-medium">Terdaftar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => {
                  const isProtectedMaster = u.email.toLowerCase() === 'fachrull.gs@gmail.com';
                  const rowEditable =
                    canManageUsers &&
                    !isProtectedMaster &&
                    (isSuperadmin || u.role !== 'MANAGEMENT');

                  return (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{u.fullName}</span>
                        {isProtectedMaster && (
                          <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-50 text-[#166534] border border-emerald-200">
                            Superadmin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusTag status={u.approvalStatus === 'APPROVED' ? 'APPROVED' : u.approvalStatus === 'REJECTED' ? 'REJECTED' : 'PENDING'} />
                        {rowEditable && u.approvalStatus !== 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => handleApprovalDecision(u.id, 'APPROVED')}
                            className="text-xs font-medium text-[#166534] hover:underline cursor-pointer"
                          >
                            Setujui
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Peran untuk ${u.email}`}
                        disabled={!rowEditable}
                        value={u.role}
                        onChange={(e) => handleUpdateUser(u.id, { role: e.target.value as AppRole })}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:opacity-60"
                      >
                        <option value="KAE_SALES">KAE / Sales</option>
                        <option value="SPV_SAMPLING">SPV Sampling</option>
                        {(isSuperadmin || u.role === 'MANAGEMENT') && (
                          <option value="MANAGEMENT">Superadmin / Management</option>
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!rowEditable}
                        onClick={() => handleUpdateUser(u.id, { isActive: !u.isActive })}
                        className="cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <StatusTag status={u.isActive ? 'ACTIVE' : 'UNAVAILABLE'} />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">{formatDateId(u.createdAt)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pre-approve Email Modal */}
        <ModalDialog
          open={preapproveOpen}
          onClose={() => setPreapproveOpen(false)}
          title="Daftarkan & Setujui Pengguna Baru"
          subtitle="Pengguna yang didaftarkan di sini dapat langsung masuk menggunakan email dan kata sandi lokal sesuai peran yang ditetapkan."
          maxWidth="max-w-md"
        >
          <form onSubmit={handlePreapproveSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Alamat Email *</label>
              <input
                type="email"
                required
                value={preapproveForm.email}
                onChange={(e) => setPreapproveForm({ ...preapproveForm, email: e.target.value })}
                placeholder="nama@perusahaan.co.id"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap *</label>
              <input
                type="text"
                required
                value={preapproveForm.fullName}
                onChange={(e) => setPreapproveForm({ ...preapproveForm, fullName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Peran Aplikasi *</label>
              <select
                value={preapproveForm.role}
                onChange={(e) => setPreapproveForm({ ...preapproveForm, role: e.target.value as AppRole })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="KAE_SALES">KAE / Sales</option>
                <option value="SPV_SAMPLING">SPV Sampling</option>
                {isSuperadmin && <option value="MANAGEMENT">Superadmin / Management</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Kata Sandi Awal (opsional, min. 8 karakter)
              </label>
              <input
                type="password"
                minLength={8}
                value={preapproveForm.password}
                onChange={(e) => setPreapproveForm({ ...preapproveForm, password: e.target.value })}
                placeholder="Kosongkan jika pengguna akan membuat sandi sendiri"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPreapproveOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
              >
                Simpan &amp; Setujui
              </button>
            </div>
          </form>
        </ModalDialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5">
        <Settings className="w-6 h-6 text-[#25AC43]" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pengaturan Sistem</h1>
          <p className="text-sm text-slate-500">
            Konfigurasi format penomoran SPS otomatis, kebijakan pengarsipan, serta reset data demonstrasi.
          </p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
      {successMsg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-700">{successMsg}</div>}

      <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 max-w-2xl">
        <h2 className="text-sm font-semibold text-slate-900">Format Penomoran SPS &amp; Kebijakan Arsip</h2>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Pola Nomor SPS</label>
          <input
            type="text"
            value={spsPattern}
            onChange={(e) => setSpsPattern(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Placeholder didukung: {'{SEQ}'}, {'{ROMAN_MONTH}'}, {'{MONTH}'}, {'{YEAR}'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Urut Berikutnya</label>
            <input
              type="number"
              min={1}
              value={nextSequence}
              onChange={(e) => setNextSequence(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Interval Tunda Arsip (Hari)</label>
            <input
              type="number"
              min={1}
              max={90}
              value={deferDays}
              onChange={(e) => setDeferDays(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
        </div>
        <div className="pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pengaturan</span>
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Data Demonstrasi &amp; Pelatihan Operasional</h2>
        <p className="text-xs text-slate-600">
          Muat ulang catatan demonstrasi standar PT ANKAL (permintaan sampling, personel internal &amp; freelance, kendaraan, serta contoh SPS aktif/pending arsip/terarsip).
        </p>
        <button
          type="button"
          onClick={handleResetDemo}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-md cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Muat Ulang Data Demonstrasi</span>
        </button>
      </div>
    </div>
  );
}
