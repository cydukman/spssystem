import React, { useEffect, useState } from 'react';
import { Plus, CalendarPlus, AlertCircle, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppUser, PersonnelRecord, SamplingRequest, Vehicle } from '../../types/ankal';
import { ModalDialog, SkeletonTable, StatusTag, formatDateTimeId } from '../ui/Common';

interface VehicleReservationRow {
  id: string;
  vehicleId: string;
  requestId: string;
  departureTime: string;
  returnTime: string;
  destination: string;
  passengerCount: number;
  status: string;
  vehicle: Vehicle | null;
  request: SamplingRequest | null;
  driver: PersonnelRecord | null;
}

export function VehiclesView({
  user,
  onChanged,
}: {
  user: AppUser;
  onChanged: () => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [reservations, setReservations] = useState<VehicleReservationRow[]>([]);
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [personnelList, setPersonnelList] = useState<PersonnelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [vehForm, setVehForm] = useState({
    vehicleCode: '',
    registrationNumber: '',
    model: '',
    vehicleType: 'MPV Operasional',
    passengerCapacity: 6,
    baseLocation: 'Bekasi',
    notes: '',
  });

  const [reserveOpen, setReserveOpen] = useState(false);
  const [resForm, setResForm] = useState({
    vehicleId: '',
    requestId: '',
    driverPersonnelId: '',
    departureTime: '',
    returnTime: '',
    destination: '',
    passengerCount: 2,
    notes: '',
  });
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const loadData = async () => {
    setLoading(true);
    try {
      const [vRes, reqs, pers] = await Promise.all([
        apiFetch<{ vehicles: Vehicle[]; reservations: VehicleReservationRow[] }>('/api/vehicles'),
        apiFetch<SamplingRequest[]>('/api/requests'),
        apiFetch<PersonnelRecord[]>('/api/personnel'),
      ]);
      setVehicles(vRes.vehicles);
      setReservations(vRes.reservations);
      setRequests(reqs);
      setPersonnelList(pers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat manajemen kendaraan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify(vehForm),
      });
      setAddVehicleOpen(false);
      setVehForm({
        vehicleCode: '',
        registrationNumber: '',
        model: '',
        vehicleType: 'MPV Operasional',
        passengerCapacity: 6,
        baseLocation: 'Bekasi',
        notes: '',
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menambah kendaraan.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, operationalStatus: Vehicle['operationalStatus']) => {
    setError(null);
    try {
      await apiFetch(`/api/vehicles/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ operationalStatus }),
      });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui status kendaraan.');
    }
  };

  const handleConfirmDeleteVehicle = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/vehicles/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      setDeleteTarget(null);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus kendaraan.');
    } finally {
      setSubmitting(false);
    }
  };

  const openReserveModal = (vehicleId?: string) => {
    const assignable = requests.filter((r) =>
      ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status)
    );
    const firstReq = assignable[0];
    const activeSch = firstReq?.schedules.find((s) => s.isActive);
    const dep = activeSch
      ? new Date(activeSch.startDate).toISOString().slice(0, 16)
      : new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    const ret = activeSch
      ? new Date(activeSch.endDate).toISOString().slice(0, 16)
      : new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 16);

    setResForm({
      vehicleId: vehicleId || vehicles.find((v) => v.operationalStatus === 'AVAILABLE')?.id || vehicles[0]?.id || '',
      requestId: firstReq?.id || '',
      driverPersonnelId: '',
      departureTime: dep,
      returnTime: ret,
      destination: firstReq?.samplingLocation || '',
      passengerCount: Math.max(2, firstReq?.assignments.length || 2),
      notes: '',
    });
    setReserveOpen(true);
  };

  const handleReserveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/vehicle-reservations', {
        method: 'POST',
        body: JSON.stringify({
          ...resForm,
          driverPersonnelId: resForm.driverPersonnelId || null,
          departureTime: new Date(resForm.departureTime).toISOString(),
          returnTime: new Date(resForm.returnTime).toISOString(),
          passengerCount: Number(resForm.passengerCount),
        }),
      });
      setReserveOpen(false);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mereservasi kendaraan.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <SkeletonTable rows={5} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manajemen Kendaraan Operasional</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Monitoring armada, kapasitas penumpang, serta reservasi kendaraan dengan validasi bentrok jadwal dan pengemudi.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openReserveModal()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md cursor-pointer"
            >
              <CalendarPlus className="w-4 h-4" />
              <span>Reservasi Kendaraan</span>
            </button>
            <button
              type="button"
              onClick={() => setAddVehicleOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Armada</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Fleet Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Armada Kendaraan PT ANKAL</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Kode &amp; Pelat Nomor</th>
                <th className="px-4 py-3 font-medium">Model &amp; Tipe</th>
                <th className="px-4 py-3 font-medium">Kapasitas</th>
                <th className="px-4 py-3 font-medium">Lokasi Base</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canManage && <th className="px-4 py-3 font-medium text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-slate-500 tabular-nums">{v.vehicleCode}</div>
                    <div className="font-semibold text-slate-900 tabular-nums">{v.registrationNumber}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{v.model}</div>
                    <div className="text-xs text-slate-500">{v.vehicleType}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 tabular-nums">
                    {v.passengerCapacity} Penumpang
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">{v.baseLocation}</td>
                  <td className="px-4 py-3">
                    <StatusTag status={v.operationalStatus} />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <select
                          aria-label={`Ubah status ${v.registrationNumber}`}
                          value={v.operationalStatus}
                          onChange={(e) =>
                            handleStatusChange(v.id, e.target.value as Vehicle['operationalStatus'])
                          }
                          className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        >
                          <option value="AVAILABLE">Tersedia</option>
                          <option value="ASSIGNED">Ditugaskan</option>
                          <option value="MAINTENANCE">Perawatan</option>
                          <option value="UNAVAILABLE">Tidak Tersedia</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => openReserveModal(v.id)}
                          className="px-2.5 py-1 text-xs font-medium text-[#166534] bg-[#f0fdf4] border border-[#25AC43]/40 rounded hover:bg-[#dcfce7] cursor-pointer"
                        >
                          Reservasi
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(v)}
                          aria-label={`Hapus kendaraan ${v.registrationNumber}`}
                          title="Hapus Kendaraan"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reservations List */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Riwayat &amp; Jadwal Reservasi Kendaraan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Kendaraan</th>
                <th className="px-4 py-3 font-medium">Pekerjaan &amp; Tujuan</th>
                <th className="px-4 py-3 font-medium">Berangkat / Kembali</th>
                <th className="px-4 py-3 font-medium">Pengemudi &amp; Penumpang</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reservations.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-semibold text-slate-900 tabular-nums">{r.vehicle?.registrationNumber}</div>
                    <div className="text-slate-500">{r.vehicle?.model}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-slate-900">{r.request?.customerName || '-'}</div>
                    <div className="text-slate-600">{r.destination}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    <div>{formatDateTimeId(r.departureTime)}</div>
                    <div className="text-slate-500">s.d. {formatDateTimeId(r.returnTime)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div>{r.driver?.fullName || 'Tim Lapangan'}</div>
                    <div className="text-slate-500 tabular-nums">{r.passengerCount} orang</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusTag status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Vehicle Modal */}
      <ModalDialog
        open={addVehicleOpen}
        onClose={() => setAddVehicleOpen(false)}
        title="Tambah Kendaraan Operasional"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleAddVehicle} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kode Kendaraan *</label>
              <input
                type="text"
                required
                value={vehForm.vehicleCode}
                onChange={(e) => setVehForm({ ...vehForm, vehicleCode: e.target.value })}
                placeholder="VEH-05"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Polisi *</label>
              <input
                type="text"
                required
                value={vehForm.registrationNumber}
                onChange={(e) => setVehForm({ ...vehForm, registrationNumber: e.target.value })}
                placeholder="B 1234 AKL"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Model Kendaraan *</label>
              <input
                type="text"
                required
                value={vehForm.model}
                onChange={(e) => setVehForm({ ...vehForm, model: e.target.value })}
                placeholder="Toyota Innova Zenix"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kapasitas Penumpang *</label>
              <input
                type="number"
                min={1}
                max={20}
                required
                value={vehForm.passengerCapacity}
                onChange={(e) => setVehForm({ ...vehForm, passengerCapacity: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Lokasi Base *</label>
            <input
              type="text"
              required
              value={vehForm.baseLocation}
              onChange={(e) => setVehForm({ ...vehForm, baseLocation: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddVehicleOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md"
            >
              Simpan Kendaraan
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Vehicle Reservation Modal */}
      <ModalDialog
        open={reserveOpen}
        onClose={() => setReserveOpen(false)}
        title="Reservasi Kendaraan Lapangan"
        subtitle="Sistem memeriksa kapasitas penumpang, tumpang tindih waktu kendaraan, serta jadwal pengemudi."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleReserveSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Kendaraan *</label>
            <select
              required
              value={resForm.vehicleId}
              onChange={(e) => setResForm({ ...resForm, vehicleId: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber} — {v.model} (Maks. {v.passengerCapacity} org · {v.operationalStatus})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Permintaan / Pekerjaan *</label>
            <select
              required
              value={resForm.requestId}
              onChange={(e) => {
                const req = requests.find((r) => r.id === e.target.value);
                setResForm({
                  ...resForm,
                  requestId: e.target.value,
                  destination: req?.samplingLocation || resForm.destination,
                });
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              {requests
                .filter((r) => ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requestNumber} — {r.customerName}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Berangkat *</label>
              <input
                type="datetime-local"
                required
                value={resForm.departureTime}
                onChange={(e) => setResForm({ ...resForm, departureTime: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kembali *</label>
              <input
                type="datetime-local"
                required
                value={resForm.returnTime}
                onChange={(e) => setResForm({ ...resForm, returnTime: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pengemudi (Opsional)</label>
              <select
                value={resForm.driverPersonnelId}
                onChange={(e) => setResForm({ ...resForm, driverPersonnelId: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="">-- Tanpa pengemudi khusus --</option>
                {personnelList
                  .filter((p) => p.fieldEligible)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.fullName}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jumlah Penumpang *</label>
              <input
                type="number"
                min={1}
                max={20}
                required
                value={resForm.passengerCount}
                onChange={(e) => setResForm({ ...resForm, passengerCount: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Tujuan Pengambilan Contoh Uji *</label>
            <input
              type="text"
              required
              value={resForm.destination}
              onChange={(e) => setResForm({ ...resForm, destination: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setReserveOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Memvalidasi...' : 'Konfirmasi Reservasi'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Delete Vehicle Confirmation Modal */}
      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Hapus Kendaraan Operasional"
        subtitle={deleteTarget ? `${deleteTarget.registrationNumber} · ${deleteTarget.model}` : ''}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Apakah Anda yakin ingin menghapus kendaraan{' '}
            <span className="font-semibold text-slate-900">{deleteTarget?.registrationNumber}</span>{' '}
            ({deleteTarget?.model}) dari daftar armada? Kendaraan dengan reservasi aktif tidak dapat dihapus.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmDeleteVehicle}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60 cursor-pointer"
            >
              {submitting ? 'Menghapus...' : 'Ya, Hapus Kendaraan'}
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
