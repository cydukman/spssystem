import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Copy,
  Send,
  Edit3,
  CheckCircle2,
  CalendarClock,
  Eye,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type {
  AppUser,
  Customer,
  MatrixMaster,
  ParameterMaster,
  RegulationMaster,
  RequestMatrixItem,
  SamplingRequest,
} from '../../types/ankal';
import {
  EmptyState,
  ModalDialog,
  SkeletonTable,
  StatusTag,
  formatDateId,
  formatDateRangeId,
} from '../ui/Common';

interface MasterDataResponse {
  customers: Customer[];
  matrices: MatrixMaster[];
  parameters: ParameterMaster[];
  regulations: RegulationMaster[];
}

const EMPTY_MATRIX = (): RequestMatrixItem => ({
  matrixId: null,
  matrixName: '',
  pointCount: 1,
  pointDescription: '',
  regulationId: null,
  regulationName: '-',
  notes: '',
  parameters: [
    {
      parameterId: null,
      parameterName: '',
      unit: '-',
      isSubcontracted: false,
    },
  ],
});

export function RequestsView({
  user,
  onNavigate,
  onChanged,
}: {
  user: AppUser;
  onNavigate: (route: string) => void;
  onChanged: () => void;
}) {
  const [requests, setRequests] = useState<SamplingRequest[]>([]);
  const [master, setMaster] = useState<MasterDataResponse>({
    customers: [],
    matrices: [],
    parameters: [],
    regulations: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Create / Edit Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerPic, setCustomerPic] = useState('');
  const [picPhone, setPicPhone] = useState('');
  const [jobName, setJobName] = useState('');
  const [lhpNumber, setLhpNumber] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedEndDate, setProposedEndDate] = useState('');
  const [proposedTime, setProposedTime] = useState('08:00');
  const [estimatedDurationHours, setEstimatedDurationHours] = useState(8);
  const [mobilizationHours, setMobilizationHours] = useState(2);
  const [samplingLocation, setSamplingLocation] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [attachmentNames, setAttachmentNames] = useState('');
  const [matrixRows, setMatrixRows] = useState<RequestMatrixItem[]>([EMPTY_MATRIX()]);

  // New Customer Inline Modal
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newCustForm, setNewCustForm] = useState({
    name: '',
    address: '',
    phone: '',
    picName: '',
    picPhone: '',
    email: '',
    industry: '',
  });

  // Detail & Review & Schedule Revision Modals
  const [detailReq, setDetailReq] = useState<SamplingRequest | null>(null);
  const [reviewReq, setReviewReq] = useState<SamplingRequest | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'REVISION_REQUESTED' | 'REJECTED'>('APPROVED');
  const [reviewComments, setReviewComments] = useState('');

  const [reviseScheduleReq, setReviseScheduleReq] = useState<SamplingRequest | null>(null);
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const [postponeReason, setPostponeReason] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqs, mData] = await Promise.all([
        apiFetch<SamplingRequest[]>('/api/requests'),
        apiFetch<MasterDataResponse>('/api/master'),
      ]);
      setRequests(reqs);
      setMaster(mData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar permintaan.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const canReview = user.role === 'SPV_SAMPLING' || user.role === 'MANAGEMENT';

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hit =
          r.requestNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.jobName.toLowerCase().includes(q) ||
          r.samplingLocation.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [requests, statusFilter, search]);

  const openCreateModal = () => {
    setEditingId(null);
    setCustomerId('');
    setCustomerName('');
    setCustomerAddress('');
    setCustomerPhone('-');
    setCustomerPic('');
    setPicPhone('');
    setJobName('');
    setLhpNumber('');
    setContractNumber('');
    setJobDescription('');
    const nextWeek = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    setProposedDate(nextWeek);
    setProposedEndDate(nextWeek);
    setProposedTime('08:00');
    setEstimatedDurationHours(8);
    setMobilizationHours(2);
    setSamplingLocation('');
    setSpecialInstructions('');
    setAttachmentNames('');
    const firstMatrix = master.matrices[0];
    setMatrixRows([
      {
        matrixId: firstMatrix?.id || null,
        matrixName: firstMatrix?.name || 'Air Limbah',
        pointCount: 2,
        pointDescription: 'Inlet & Outlet IPAL',
        regulationId: null,
        regulationName: '',
        notes: '',
        parameters: [
          {
            parameterId: null,
            parameterName: '',
            unit: '-',
            isSubcontracted: false,
          },
        ],
      },
    ]);
    setFormOpen(true);
  };

  const openEditModal = (req: SamplingRequest) => {
    setEditingId(req.id);
    setCustomerId(req.customerId || '');
    setCustomerName(req.customerName);
    setCustomerAddress(req.customerAddress);
    setCustomerPhone(req.customerPhone || '-');
    setCustomerPic(req.customerPic);
    setPicPhone(req.picPhone);
    setJobName(req.jobName);
    setLhpNumber(req.lhpNumber || '');
    setContractNumber(req.contractNumber || '');
    setJobDescription(req.jobDescription || '');
    setProposedDate(new Date(req.proposedDate).toISOString().slice(0, 10));
    setProposedEndDate(new Date(req.proposedEndDate || req.proposedDate).toISOString().slice(0, 10));
    setProposedTime(req.proposedTime || '08:00');
    setEstimatedDurationHours(req.estimatedDurationHours || 8);
    setMobilizationHours(req.mobilizationHours ?? 2);
    setSamplingLocation(req.samplingLocation);
    setSpecialInstructions(req.specialInstructions || '');
    setAttachmentNames((req.attachments || []).map((a) => a.name).join(', '));
    setMatrixRows(
      req.matrices && req.matrices.length > 0
        ? req.matrices.map((m) => ({
            matrixId: m.matrixId || null,
            matrixName: m.matrixName,
            pointCount: m.pointCount,
            pointDescription: m.pointDescription,
            regulationId: m.regulationId || null,
            regulationName: m.regulationName,
            notes: m.notes || '',
            parameters:
              m.parameters && m.parameters.length > 0
                ? m.parameters
                : [{ parameterName: 'pH', unit: '-', isSubcontracted: false }],
          }))
        : [EMPTY_MATRIX()]
    );
    setFormOpen(true);
  };

  const handleSelectCustomer = (id: string) => {
    setCustomerId(id);
    const c = master.customers.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerAddress(c.address);
      setCustomerPhone(c.phone || '-');
      setCustomerPic(c.picName);
      setPicPhone(c.picPhone);
      if (!samplingLocation) setSamplingLocation(c.address);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiFetch<Customer>('/api/master/customers', {
        method: 'POST',
        body: JSON.stringify(newCustForm),
      });
      setMaster((prev) => ({ ...prev, customers: [...prev.customers, created] }));
      setCustomerId(created.id);
      setCustomerName(created.name);
      setCustomerAddress(created.address);
      setCustomerPhone(created.phone);
      setCustomerPic(created.picName);
      setPicPhone(created.picPhone);
      setSamplingLocation(created.address);
      setNewCustomerOpen(false);
      setNewCustForm({ name: '', address: '', phone: '', picName: '', picPhone: '', email: '', industry: '' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mendaftarkan pelanggan.');
    }
  };

  const handleSaveRequest = async (submitImmediately: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const attachments = attachmentNames
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name }));

      const startDt = new Date(`${proposedDate}T${proposedTime || '08:00'}:00`);
      const effectiveEndDay =
        proposedEndDate && proposedEndDate >= proposedDate ? proposedEndDate : proposedDate;
      const endDt =
        effectiveEndDay === proposedDate
          ? new Date(startDt.getTime() + (Number(estimatedDurationHours) || 8) * 3600 * 1000)
          : new Date(`${effectiveEndDay}T17:00:00`);

      const payload = {
        customerId: customerId || null,
        customerName,
        customerAddress,
        customerPhone: customerPhone || '-',
        customerPic,
        picPhone,
        jobName,
        lhpNumber,
        contractNumber,
        jobDescription,
        proposedDate: startDt.toISOString(),
        proposedEndDate: endDt.toISOString(),
        proposedTime,
        estimatedDurationHours: Number(estimatedDurationHours),
        mobilizationHours: Number(mobilizationHours),
        samplingLocation,
        specialInstructions,
        attachments,
        matrices: matrixRows.map((m) => ({
          ...m,
          pointCount: Number(m.pointCount) || 1,
          parameters: m.parameters.filter((p) => p.parameterName.trim().length > 0),
        })),
        submitImmediately,
      };

      if (editingId) {
        await apiFetch(`/api/requests/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/requests', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      setFormOpen(false);
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan permintaan sampling.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitExisting = async (id: string) => {
    try {
      await apiFetch(`/api/requests/${id}/submit`, { method: 'POST' });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengajukan permintaan.');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await apiFetch(`/api/requests/${id}/duplicate`, { method: 'POST' });
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menduplikasi permintaan.');
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewReq) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/requests/${reviewReq.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision: reviewDecision,
          comments: reviewComments,
        }),
      });
      setReviewReq(null);
      setReviewComments('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan keputusan review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviseScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviseScheduleReq) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/requests/${reviseScheduleReq.id}/schedule-revision`, {
        method: 'POST',
        body: JSON.stringify({
          newStartDate: new Date(newStart).toISOString(),
          newEndDate: new Date(newEnd).toISOString(),
          postponeReason,
        }),
      });
      setReviseScheduleReq(null);
      setPostponeReason('');
      await loadData();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal merevisi jadwal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Permintaan Sampling</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pengajuan permintaan sampling pelanggan, tinjauan kelayakan SPV Sampling, dan riwayat revisi jadwal.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Permintaan Sampling Baru</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Search & Filter */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor permintaan, pelanggan, pekerjaan, atau lokasi..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#25AC43]"
          />
        </div>
        <select
          aria-label="Filter status permintaan"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#25AC43]"
        >
          <option value="ALL">Semua Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Diajukan</option>
          <option value="REVISION_REQUESTED">Diminta Revisi</option>
          <option value="APPROVED">Disetujui</option>
          <option value="SCHEDULED">Terjadwal</option>
          <option value="COMPLETED">Selesai</option>
          <option value="REJECTED">Ditolak</option>
        </select>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title="Belum ada permintaan sampling"
          description="Buat permintaan sampling baru atau ubah filter pencarian untuk melihat data yang tersedia."
          actionLabel="Buat Permintaan Baru"
          onAction={openCreateModal}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nomor</th>
                  <th className="px-4 py-3 font-medium">Pelanggan &amp; Pekerjaan</th>
                  <th className="px-4 py-3 font-medium">Matriks &amp; Titik</th>
                  <th className="px-4 py-3 font-medium">Jadwal Usulan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((req) => {
                  const canEditReq =
                    (user.role !== 'KAE_SALES' && req.status !== 'COMPLETED' && req.status !== 'ARCHIVED') ||
                    req.status === 'DRAFT' ||
                    req.status === 'REVISION_REQUESTED';

                  return (
                    <tr key={req.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {req.requestNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Rev. {req.revisionNumber} · {req.createdByName}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-900">{req.customerName}</div>
                        <div className="text-xs text-slate-600">{req.jobName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{req.samplingLocation}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-700">
                        {req.matrices.map((m, idx) => (
                          <div key={idx} className="mb-0.5">
                            <span className="font-medium">{m.matrixName}</span> ({m.pointCount} ttk)
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-700 whitespace-nowrap tabular-nums">
                        <div>{formatDateRangeId(req.proposedDate, req.proposedEndDate)}</div>
                        <div className="text-slate-500">
                          {req.proposedTime} WIB · {req.estimatedDurationHours} jam
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusTag status={req.status} />
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailReq(req)}
                            title="Lihat Detail"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Detail</span>
                          </button>

                          {canEditReq && (
                            <button
                              type="button"
                              onClick={() => openEditModal(req)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Ubah</span>
                            </button>
                          )}

                          {(req.status === 'DRAFT' || req.status === 'REVISION_REQUESTED') && (
                            <button
                              type="button"
                              onClick={() => handleSubmitExisting(req.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Ajukan</span>
                            </button>
                          )}

                          {canReview && (req.status === 'SUBMITTED' || req.status === 'UNDER_REVIEW') && (
                            <button
                              type="button"
                              onClick={() => {
                                setReviewReq(req);
                                setReviewDecision('APPROVED');
                                setReviewComments('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Tinjau</span>
                            </button>
                          )}

                          {canReview && req.status === 'APPROVED' && (
                            <button
                              type="button"
                              onClick={() => onNavigate('scheduling')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 cursor-pointer"
                            >
                              <span>Tugaskan Tim</span>
                            </button>
                          )}

                          {canReview && ['APPROVED', 'ASSIGNED', 'SCHEDULED'].includes(req.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                const activeSch = req.schedules.find((s) => s.isActive);
                                const startStr = (activeSch ? activeSch.startDate : req.proposedDate).slice(0, 16);
                                const endStr = (activeSch ? activeSch.endDate : req.proposedEndDate || req.proposedDate).slice(0, 16);
                                setNewStart(startStr);
                                setNewEnd(endStr);
                                setPostponeReason('');
                                setReviseScheduleReq(req);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 cursor-pointer"
                            >
                              <CalendarClock className="w-3.5 h-3.5" />
                              <span>Revisi Jadwal</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDuplicate(req.id)}
                            title="Duplikasi menjadi Draft baru"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Duplikasi</span>
                          </button>
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

      {/* Create / Edit Request Modal */}
      <ModalDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Ubah Permintaan Sampling' : 'Permintaan Sampling Baru'}
        subtitle="Lengkapi informasi pelanggan, jadwal usulan, serta daftar matriks dan parameter uji."
        maxWidth="max-w-4xl"
      >
        <div className="space-y-5">
          {/* Customer Selection */}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="req-customer-select" className="text-xs font-semibold text-slate-800 uppercase">
                Informasi Pelanggan
              </label>
              <button
                type="button"
                onClick={() => setNewCustomerOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#166534] hover:underline cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Daftarkan Pelanggan Baru</span>
              </button>
            </div>
            <select
              id="req-customer-select"
              value={customerId}
              onChange={(e) => handleSelectCustomer(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="">-- Pilih Pelanggan Terdaftar (atau isi manual di bawah) --</option>
              {master.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.picName})
                </option>
              ))}
            </select>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Perusahaan / Pelanggan *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alamat Pelanggan *</label>
                <input
                  type="text"
                  required
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama PIC Pelanggan *</label>
                <input
                  type="text"
                  required
                  value={customerPic}
                  onChange={(e) => setCustomerPic(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">No. Telepon / HP PIC *</label>
                <input
                  type="text"
                  required
                  value={picPhone}
                  onChange={(e) => setPicPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
            </div>
          </div>

          {/* Job & Schedule Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Pekerjaan *</label>
              <input
                type="text"
                required
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                placeholder="Contoh: Pemantauan Kualitas Lingkungan Semester I Tahun 2026"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. LHP / Referensi</label>
              <input
                type="text"
                value={lhpNumber}
                onChange={(e) => setLhpNumber(e.target.value)}
                placeholder="Opsional (mis. 0426001)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. Kontrak / PO</label>
              <input
                type="text"
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="Opsional"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Mulai Sampling *</label>
                <input
                  type="date"
                  required
                  value={proposedDate}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setProposedDate(nextStart);
                    if (!proposedEndDate || proposedEndDate < nextStart) {
                      setProposedEndDate(nextStart);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Selesai Sampling *</label>
                <input
                  type="date"
                  required
                  min={proposedDate || undefined}
                  value={proposedEndDate}
                  onChange={(e) => setProposedEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Jam Mulai</label>
                <input
                  type="time"
                  value={proposedTime}
                  onChange={(e) => setProposedTime(e.target.value)}
                  className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Jam)</label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={estimatedDurationHours}
                  onChange={(e) => setEstimatedDurationHours(Number(e.target.value))}
                  className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mobilisasi</label>
                <input
                  type="number"
                  min={0}
                  max={72}
                  value={mobilizationHours}
                  onChange={(e) => setMobilizationHours(Number(e.target.value))}
                  className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Lokasi Sampling *</label>
              <input
                type="text"
                required
                value={samplingLocation}
                onChange={(e) => setSamplingLocation(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Persyaratan Operasional Khusus / Catatan K3</label>
              <textarea
                rows={2}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Contoh: Wajib APD lengkap, safety induction pukul 07.30 WIB"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Lampiran Pendukung (pisahkan koma)</label>
              <input
                type="text"
                value={attachmentNames}
                onChange={(e) => setAttachmentNames(e.target.value)}
                placeholder="Contoh: PO_Pelanggan.pdf, Denah_Titik_Sampling.pdf"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          {/* Dynamic Matrix & Parameter Builder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Matriks, Titik &amp; Parameter Uji</h3>
              <button
                type="button"
                onClick={() => setMatrixRows((prev) => [...prev, EMPTY_MATRIX()])}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#166534] bg-[#f0fdf4] border border-[#25AC43]/40 rounded hover:bg-[#dcfce7] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Matriks</span>
              </button>
            </div>

            {matrixRows.map((m, mIdx) => (
              <div key={mIdx} className="border border-slate-200 rounded-md p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Matriks #{mIdx + 1}</span>
                  {matrixRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setMatrixRows((prev) => prev.filter((_, i) => i !== mIdx))}
                      className="text-xs text-red-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Matriks</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4">
                    <label className="block text-xs text-slate-600 mb-1">Nama Matriks *</label>
                    <select
                      value={m.matrixName}
                      onChange={(e) => {
                        const found = master.matrices.find((x) => x.name === e.target.value);
                        setMatrixRows((prev) =>
                          prev.map((row, idx) =>
                            idx === mIdx
                              ? { ...row, matrixId: found?.id || null, matrixName: e.target.value }
                              : row
                          )
                        );
                      }}
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded bg-white"
                    >
                      <option value="">-- Pilih Matriks --</option>
                      {master.matrices.map((mx) => (
                        <option key={mx.id} value={mx.name}>
                          {mx.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-slate-600 mb-1">Jml Titik *</label>
                    <input
                      type="number"
                      min={1}
                      value={m.pointCount}
                      onChange={(e) =>
                        setMatrixRows((prev) =>
                          prev.map((row, idx) =>
                            idx === mIdx ? { ...row, pointCount: Number(e.target.value) } : row
                          )
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-6">
                    <label className="block text-xs text-slate-600 mb-1">Keterangan Titik Lokasi *</label>
                    <input
                      type="text"
                      value={m.pointDescription}
                      onChange={(e) =>
                        setMatrixRows((prev) =>
                          prev.map((row, idx) =>
                            idx === mIdx ? { ...row, pointDescription: e.target.value } : row
                          )
                        )
                      }
                      placeholder="Mis. Inlet IPAL, Outlet IPAL"
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded"
                    />
                  </div>
                  <div className="sm:col-span-12">
                    <label className="block text-xs text-slate-600 mb-1">Regulasi / Baku Mutu *</label>
                    <input
                      type="text"
                      required
                      value={m.regulationName}
                      onChange={(e) => {
                        setMatrixRows((prev) =>
                          prev.map((row, idx) =>
                            idx === mIdx
                              ? { ...row, regulationId: null, regulationName: e.target.value }
                              : row
                          )
                        );
                      }}
                      placeholder="Contoh: PermenLHK P.68/2016 atau PP No. 22 Tahun 2021"
                      className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded"
                    />
                  </div>
                </div>

                {/* Parameters */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Daftar Parameter Uji</span>
                    <button
                      type="button"
                      onClick={() =>
                        setMatrixRows((prev) =>
                          prev.map((row, idx) =>
                            idx === mIdx
                              ? {
                                  ...row,
                                  parameters: [
                                    ...row.parameters,
                                    { parameterName: '', unit: '-', isSubcontracted: false },
                                  ],
                                }
                              : row
                          )
                        )
                      }
                      className="text-xs font-medium text-[#166534] hover:underline cursor-pointer"
                    >
                      + Tambah Parameter
                    </button>
                  </div>

                  {m.parameters.map((p, pIdx) => (
                    <div key={pIdx} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <input
                        type="text"
                        value={p.parameterName}
                        onChange={(e) => {
                          setMatrixRows((prev) =>
                            prev.map((row, idx) =>
                              idx === mIdx
                                ? {
                                    ...row,
                                    parameters: row.parameters.map((pr, i2) =>
                                      i2 === pIdx
                                        ? {
                                            ...pr,
                                            parameterId: null,
                                            parameterName: e.target.value,
                                            isSubcontracted: false,
                                          }
                                        : pr
                                    ),
                                  }
                                : row
                            )
                          );
                        }}
                        placeholder="Nama parameter (mis. pH, COD, BOD5, TSS, PM2.5)"
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      <input
                        type="text"
                        value={p.unit}
                        onChange={(e) =>
                          setMatrixRows((prev) =>
                            prev.map((row, idx) =>
                              idx === mIdx
                                ? {
                                    ...row,
                                    parameters: row.parameters.map((pr, i2) =>
                                      i2 === pIdx ? { ...pr, unit: e.target.value } : pr
                                    ),
                                  }
                                : row
                            )
                          )
                        }
                        placeholder="Satuan"
                        className="w-24 px-2 py-1.5 text-xs border border-slate-300 rounded"
                      />
                      {m.parameters.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setMatrixRows((prev) =>
                              prev.map((row, idx) =>
                                idx === mIdx
                                  ? { ...row, parameters: row.parameters.filter((_, i2) => i2 !== pIdx) }
                                  : row
                              )
                            )
                          }
                          aria-label="Hapus parameter"
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSaveRequest(false)}
              className="px-4 py-2 text-sm font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-60"
            >
              Simpan sebagai Draft
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSaveRequest(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Ajukan ke SPV Sampling'}
            </button>
          </div>
        </div>
      </ModalDialog>

      {/* Inline New Customer Modal */}
      <ModalDialog
        open={newCustomerOpen}
        onClose={() => setNewCustomerOpen(false)}
        title="Registrasi Pelanggan Baru"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateCustomer} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Nama Perusahaan *</label>
            <input
              type="text"
              required
              value={newCustForm.name}
              onChange={(e) => setNewCustForm({ ...newCustForm, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Alamat *</label>
            <input
              type="text"
              required
              value={newCustForm.address}
              onChange={(e) => setNewCustForm({ ...newCustForm, address: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama PIC *</label>
              <input
                type="text"
                required
                value={newCustForm.picName}
                onChange={(e) => setNewCustForm({ ...newCustForm, picName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">No. HP PIC *</label>
              <input
                type="text"
                required
                value={newCustForm.picPhone}
                onChange={(e) => setNewCustForm({ ...newCustForm, picPhone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Telp Kantor</label>
              <input
                type="text"
                value={newCustForm.phone}
                onChange={(e) => setNewCustForm({ ...newCustForm, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sektor Industri</label>
              <input
                type="text"
                value={newCustForm.industry}
                onChange={(e) => setNewCustForm({ ...newCustForm, industry: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewCustomerOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md"
            >
              Simpan Pelanggan
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Request Detail Modal */}
      <ModalDialog
        open={Boolean(detailReq)}
        onClose={() => setDetailReq(null)}
        title={detailReq ? `Detail Permintaan ${detailReq.requestNumber}` : ''}
        subtitle={detailReq ? `${detailReq.customerName} · ${detailReq.jobName}` : ''}
        maxWidth="max-w-3xl"
      >
        {detailReq && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <StatusTag status={detailReq.status} />
              <span className="text-xs text-slate-500 tabular-nums">
                Diajukan oleh {detailReq.createdByName} · Revisi {detailReq.revisionNumber}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-md border border-slate-200">
              <div><span className="text-slate-500">Pelanggan:</span> <span className="font-medium">{detailReq.customerName}</span></div>
              <div><span className="text-slate-500">PIC:</span> <span className="font-medium">{detailReq.customerPic} ({detailReq.picPhone})</span></div>
              <div><span className="text-slate-500">Lokasi:</span> <span className="font-medium">{detailReq.samplingLocation}</span></div>
              <div><span className="text-slate-500">Jadwal Usulan:</span> <span className="font-medium tabular-nums">{formatDateRangeId(detailReq.proposedDate, detailReq.proposedEndDate)} ({detailReq.proposedTime} WIB)</span></div>
              <div className="sm:col-span-2"><span className="text-slate-500">Instruksi Khusus:</span> <span className="font-medium">{detailReq.specialInstructions || '-'}</span></div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase text-slate-700 mb-2">Rincian Matriks &amp; Parameter</h4>
              <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
                {detailReq.matrices.map((m, idx) => (
                  <div key={idx} className="p-3 text-xs space-y-1">
                    <div className="font-semibold text-slate-900">
                      {idx + 1}. {m.matrixName} — {m.pointCount} Titik ({m.pointDescription})
                    </div>
                    <div className="text-slate-600">Regulasi: {m.regulationName}</div>
                    <div className="text-slate-700">
                      Parameter: {m.parameters.map((p) => `${p.parameterName}${p.isSubcontracted ? ' (Subkontrak)' : ''}`).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {detailReq.approvals && detailReq.approvals.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-700 mb-2">Riwayat Persetujuan &amp; Revisi</h4>
                <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
                  {detailReq.approvals.map((ap) => (
                    <div key={ap.id} className="p-3 text-xs flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {ap.approverName} · <span className="font-mono">{ap.decision}</span>
                        </div>
                        <div className="text-slate-600 mt-0.5">{ap.comments}</div>
                      </div>
                      <div className="text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateId(ap.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ModalDialog>

      {/* SPV Review Modal */}
      <ModalDialog
        open={Boolean(reviewReq)}
        onClose={() => setReviewReq(null)}
        title={reviewReq ? `Tinjauan SPV — ${reviewReq.requestNumber}` : ''}
        subtitle={reviewReq ? `${reviewReq.customerName} · ${reviewReq.jobName}` : ''}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleReviewSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Keputusan Operasional *</label>
            <select
              value={reviewDecision}
              onChange={(e) => setReviewDecision(e.target.value as typeof reviewDecision)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="APPROVED">Setujui Permintaan (Lanjut Penugasan)</option>
              <option value="REVISION_REQUESTED">Kembalikan untuk Revisi KAE/Sales</option>
              <option value="REJECTED">Tolak Permintaan</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Tinjauan / Alasan *</label>
            <textarea
              required
              rows={3}
              value={reviewComments}
              onChange={(e) => setReviewComments(e.target.value)}
              placeholder="Tuliskan catatan kelayakan teknis, ketersediaan alat, atau instruksi revisi..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setReviewReq(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Memproses...' : 'Simpan Keputusan'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* Schedule Revision / Postponement Modal (Scenario 13) */}
      <ModalDialog
        open={Boolean(reviseScheduleReq)}
        onClose={() => setReviseScheduleReq(null)}
        title="Revisi / Penundaan Jadwal Sampling"
        subtitle={reviseScheduleReq ? `${reviseScheduleReq.requestNumber} · ${reviseScheduleReq.customerName}` : ''}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleReviseScheduleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mulai Jadwal Baru *</label>
              <input
                type="datetime-local"
                required
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Selesai Jadwal Baru *</label>
              <input
                type="datetime-local"
                required
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Alasan Penundaan / Perubahan Jadwal *</label>
            <textarea
              required
              rows={3}
              value={postponeReason}
              onChange={(e) => setPostponeReason(e.target.value)}
              placeholder="Contoh: Penyesuaian jadwal atas permintaan pabrik pelanggan"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setReviseScheduleReq(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Perbarui Jadwal'}
            </button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
