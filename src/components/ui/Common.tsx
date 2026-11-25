import React from 'react';
import { X, AlertCircle, CheckCircle2, Clock, Ban, Archive, FileText } from 'lucide-react';

export function AnkalLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="w-8 h-8 rounded bg-[#25AC43] flex items-center justify-center text-white font-extrabold tracking-tight text-sm shrink-0">
        AKL
      </div>
      {!compact && (
        <span className="font-bold text-slate-900 tracking-tight text-base whitespace-nowrap shrink-0">
          ANKAL FieldOps
        </span>
      )}
    </div>
  );
}

const STATUS_CONFIG: Record<
  string,
  { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  DRAFT: { label: 'Draft', colorClass: 'text-slate-600 bg-slate-100 border-slate-200', Icon: FileText },
  SUBMITTED: { label: 'Diajukan', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock },
  UNDER_REVIEW: { label: 'Ditinjau SPV', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock },
  REVISION_REQUESTED: { label: 'Diminta Revisi', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertCircle },
  APPROVED: { label: 'Disetujui', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  REJECTED: { label: 'Ditolak', colorClass: 'text-red-700 bg-red-50 border-red-200', Icon: Ban },
  ASSIGNED: { label: 'Personel Ditugaskan', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: CheckCircle2 },
  SCHEDULED: { label: 'Terjadwal', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock },
  IN_PROGRESS: { label: 'Sedang Berjalan', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock },
  COMPLETED: { label: 'Selesai', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  ARCHIVED: { label: 'Diarsipkan', colorClass: 'text-slate-600 bg-slate-100 border-slate-200', Icon: Archive },
  CANCELLED: { label: 'Dibatalkan', colorClass: 'text-red-700 bg-red-50 border-red-200', Icon: Ban },
  AVAILABLE: { label: 'Tersedia', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  TENTATIVE: { label: 'Tentatif', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
  CONFIRMED: { label: 'Terkonfirmasi', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  UNAVAILABLE: { label: 'Tidak Tersedia', colorClass: 'text-red-700 bg-red-50 border-red-200', Icon: Ban },
  ON_LEAVE: { label: 'Cuti / Izin', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
  CONFLICT: { label: 'Bentrok Jadwal', colorClass: 'text-red-700 bg-red-50 border-red-200', Icon: AlertCircle },
  MAINTENANCE: { label: 'Perawatan', colorClass: 'text-red-700 bg-red-50 border-red-200', Icon: AlertCircle },
  ACTIVE: { label: 'Aktif', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  PENDING_ARCHIVAL: { label: 'Perlu Konfirmasi Arsip', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: AlertCircle },
  ARCHIVAL_DEFERRED: { label: 'Arsip Ditunda', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
  RESERVED: { label: 'Direservasi', colorClass: 'text-blue-700 bg-blue-50 border-blue-200', Icon: Clock },
  REPLACED: { label: 'Diganti', colorClass: 'text-slate-600 bg-slate-100 border-slate-200', Icon: FileText },
  PENDING_REVIEW: { label: 'Menunggu Review', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
  PENDING: { label: 'Menunggu Persetujuan', colorClass: 'text-amber-700 bg-amber-50 border-amber-200', Icon: Clock },
  IMPORTED: { label: 'Terimpor', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
};

export function StatusTag({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || {
    label: status,
    colorClass: 'text-slate-700 bg-slate-100 border-slate-200',
    Icon: FileText,
  };
  const Icon = cfg.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 ${cfg.colorClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{cfg.label}</span>
    </span>
  );
}

export function formatDateId(val?: string | Date | null): string {
  if (!val) return '-';
  const d = typeof val === 'string' ? new Date(val) : val;
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateRangeId(
  startVal?: string | Date | null,
  endVal?: string | Date | null
): string {
  if (!startVal) return '-';
  const startLabel = formatDateId(startVal);
  if (!endVal) return startLabel;
  const s = typeof startVal === 'string' ? new Date(startVal) : startVal;
  const e = typeof endVal === 'string' ? new Date(endVal) : endVal;
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return startLabel;
  if (e.getTime() <= s.getTime()) return startLabel;
  const endLabel = formatDateId(endVal);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

export function formatDateTimeId(val?: string | Date | null): string {
  if (!val) return '-';
  const d = typeof val === 'string' ? new Date(val) : val;
  if (Number.isNaN(d.getTime())) return String(val);
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ModalDialog({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-3xl',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-lg border border-slate-200 shadow-lg max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="border border-dashed border-slate-300 rounded-lg bg-white p-10 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-[#25AC43] hover:bg-[#1e8e36] rounded-md transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="h-10 bg-slate-50 border-b border-slate-200" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 last:border-b-0 animate-pulse"
        >
          <div className="h-4 bg-slate-200 rounded w-28" />
          <div className="h-4 bg-slate-100 rounded w-48" />
          <div className="h-4 bg-slate-100 rounded w-36 flex-1" />
          <div className="h-5 bg-slate-200 rounded w-20" />
        </div>
      ))}
    </div>
  );
}
