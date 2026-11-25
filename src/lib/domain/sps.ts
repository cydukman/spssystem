export interface SpsArchivalEvaluation {
  shouldPromptArchival: boolean;
  effectiveEndDate: Date | null;
  recommendedStatus:
    | 'ACTIVE'
    | 'PENDING_ARCHIVAL'
    | 'ARCHIVAL_DEFERRED'
    | 'ARCHIVED'
    | 'CANCELLED';
  message: string;
}

export interface ImportedSpsCandidate {
  document_number: string;
  customer_name: string;
  customer_address?: string;
  sampling_date?: string;
  job_name: string;
  customer_pic?: string;
  pic_phone?: string;
  matrix_name: string;
  sampling_point_count?: number;
  parameters?: string;
  applicable_regulation?: string;
  assigned_personnel?: string;
  notes?: string;
}

export interface DuplicateCheckResult {
  duplicateStatus: 'NONE' | 'EXACT_NUMBER_DUPLICATE' | 'SIMILAR_RECORD';
  matchedSpsId?: string;
  matchedSpsNumber?: string;
  reason?: string;
}

const ROMAN_MONTHS = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

export function formatSpsNumber(
  formatPattern: string,
  sequenceNumber: number,
  date: Date = new Date()
): string {
  const seq = String(sequenceNumber).padStart(3, '0');
  const monthIdx = date.getMonth();
  const romanMonth = ROMAN_MONTHS[monthIdx] || 'I';
  const monthNum = String(monthIdx + 1).padStart(2, '0');
  const year = String(date.getFullYear());

  return formatPattern
    .replaceAll('{SEQ}', seq)
    .replaceAll('{ROMAN_MONTH}', romanMonth)
    .replaceAll('{MONTH}', monthNum)
    .replaceAll('{YEAR}', year);
}

const ID_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatSamplingDateRangeLabel(
  startDate: Date,
  endDate?: Date | null
): string {
  const sYear = startDate.getUTCFullYear();
  const sMonth = startDate.getUTCMonth();
  const sDay = String(startDate.getUTCDate()).padStart(2, '0');
  const sMonthName = ID_MONTHS[sMonth] || '';

  if (!endDate || Number.isNaN(endDate.getTime())) {
    return `${sDay} ${sMonthName} ${sYear}`;
  }

  const eYear = endDate.getUTCFullYear();
  const eMonth = endDate.getUTCMonth();
  const eDay = String(endDate.getUTCDate()).padStart(2, '0');
  const eMonthName = ID_MONTHS[eMonth] || '';

  if (sYear === eYear && sMonth === eMonth && sDay === eDay) {
    return `${sDay} ${sMonthName} ${sYear}`;
  }

  if (sYear === eYear && sMonth === eMonth) {
    return `${sDay} - ${eDay} ${sMonthName} ${sYear}`;
  }

  if (sYear === eYear) {
    return `${sDay} ${sMonthName} - ${eDay} ${eMonthName} ${sYear}`;
  }

  return `${sDay} ${sMonthName} ${sYear} - ${eDay} ${eMonthName} ${eYear}`;
}

export function evaluateSpsArchivalLifecycle(params: {
  spsNumber: string;
  lifecycleStatus: string;
  originalEndDate: Date | null;
  latestApprovedScheduleEndDate: Date | null;
  archivalDeferredUntil: Date | null;
  now?: Date;
}): SpsArchivalEvaluation {
  const {
    spsNumber,
    lifecycleStatus,
    originalEndDate,
    latestApprovedScheduleEndDate,
    archivalDeferredUntil,
    now = new Date(),
  } = params;

  if (lifecycleStatus === 'ARCHIVED') {
    return {
      shouldPromptArchival: false,
      effectiveEndDate: latestApprovedScheduleEndDate ?? originalEndDate,
      recommendedStatus: 'ARCHIVED',
      message: `SPS ${spsNumber} sudah diarsipkan.`,
    };
  }

  if (lifecycleStatus === 'CANCELLED') {
    return {
      shouldPromptArchival: false,
      effectiveEndDate: latestApprovedScheduleEndDate ?? originalEndDate,
      recommendedStatus: 'CANCELLED',
      message: `SPS ${spsNumber} dibatalkan dan memerlukan keputusan pengarsipan terpisah.`,
    };
  }

  // Always prefer latest approved schedule end date if postponed/revised
  const effectiveEndDate = latestApprovedScheduleEndDate ?? originalEndDate;
  if (!effectiveEndDate) {
    return {
      shouldPromptArchival: false,
      effectiveEndDate: null,
      recommendedStatus: 'ACTIVE',
      message: `SPS ${spsNumber} aktif.`,
    };
  }

  const hasPassed = now.getTime() > effectiveEndDate.getTime();
  if (!hasPassed) {
    return {
      shouldPromptArchival: false,
      effectiveEndDate,
      recommendedStatus: 'ACTIVE',
      message: `Jadwal SPS ${spsNumber} masih aktif / belum melewati tanggal selesai.`,
    };
  }

  if (
    lifecycleStatus === 'ARCHIVAL_DEFERRED' &&
    archivalDeferredUntil &&
    now.getTime() < archivalDeferredUntil.getTime()
  ) {
    return {
      shouldPromptArchival: false,
      effectiveEndDate,
      recommendedStatus: 'ARCHIVAL_DEFERRED',
      message: `Pengarsipan SPS ${spsNumber} ditunda hingga ${archivalDeferredUntil.toISOString().slice(0, 10)}.`,
    };
  }

  return {
    shouldPromptArchival: true,
    effectiveEndDate,
    recommendedStatus: 'PENDING_ARCHIVAL',
    message: `Jadwal pengambilan contoh uji untuk SPS ${spsNumber} telah melewati tanggal pelaksanaan. Apakah dokumen ini ingin dipindahkan ke arsip?`,
  };
}

export function detectSpsDuplicate(
  candidate: {
    spsNumber: string;
    customerName: string;
    jobName: string;
    samplingDateLabel?: string;
  },
  existingDocs: Array<{
    id: string;
    spsNumber: string;
    customerName: string;
    jobName: string;
    samplingDateLabel: string;
  }>
): DuplicateCheckResult {
  const normNum = candidate.spsNumber.trim().toLowerCase();
  const exactMatch = existingDocs.find(
    (d) => d.spsNumber.trim().toLowerCase() === normNum && normNum.length > 0
  );

  if (exactMatch) {
    return {
      duplicateStatus: 'EXACT_NUMBER_DUPLICATE',
      matchedSpsId: exactMatch.id,
      matchedSpsNumber: exactMatch.spsNumber,
      reason: `Nomor SPS ${exactMatch.spsNumber} sudah terdaftar dalam database.`,
    };
  }

  const normCust = candidate.customerName.trim().toLowerCase();
  const normJob = candidate.jobName.trim().toLowerCase();
  const normDate = (candidate.samplingDateLabel || '').trim().toLowerCase();

  const similarMatch = existingDocs.find(
    (d) =>
      d.customerName.trim().toLowerCase() === normCust &&
      d.jobName.trim().toLowerCase() === normJob &&
      normDate.length > 0 &&
      d.samplingDateLabel.trim().toLowerCase() === normDate
  );

  if (similarMatch) {
    return {
      duplicateStatus: 'SIMILAR_RECORD',
      matchedSpsId: similarMatch.id,
      matchedSpsNumber: similarMatch.spsNumber,
      reason: `Kombinasi pelanggan, pekerjaan, dan tanggal mirip dengan SPS ${similarMatch.spsNumber}.`,
    };
  }

  return { duplicateStatus: 'NONE' };
}

export const DEFAULT_EXCEL_MAPPING: Record<string, string> = {
  'No SPS': 'document_number',
  'No. SPS': 'document_number',
  'Nomor SPS': 'document_number',
  Pelanggan: 'customer_name',
  Alamat: 'customer_address',
  'Tanggal Sampling': 'sampling_date',
  'Nama Pekerjaan': 'job_name',
  PIC: 'customer_pic',
  'No PIC': 'pic_phone',
  Matriks: 'matrix_name',
  'Jumlah Titik': 'sampling_point_count',
  Parameter: 'parameters',
  Regulasi: 'applicable_regulation',
  Petugas: 'assigned_personnel',
  Catatan: 'notes',
};

export function mapExcelRowsToSpsRecords(
  rows: Array<Record<string, unknown>>,
  customMapping: Record<string, string>
): Array<{
  extractedData: ImportedSpsCandidate;
  missingFields: string[];
  warnings: string[];
}> {
  return rows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const [excelCol, rawVal] of Object.entries(row)) {
      const targetField =
        customMapping[excelCol] || DEFAULT_EXCEL_MAPPING[excelCol];
      if (targetField && rawVal !== undefined && rawVal !== null) {
        mapped[targetField] = String(rawVal).trim();
      }
    }

    const pointCountRaw = Number(mapped.sampling_point_count || '1');
    const pointCount = Number.isFinite(pointCountRaw) && pointCountRaw > 0 ? pointCountRaw : 1;

    const extractedData: ImportedSpsCandidate = {
      document_number: mapped.document_number || '',
      customer_name: mapped.customer_name || '',
      customer_address: mapped.customer_address || '',
      sampling_date: mapped.sampling_date || '',
      job_name: mapped.job_name || 'Pemantauan Lingkungan',
      customer_pic: mapped.customer_pic || '',
      pic_phone: mapped.pic_phone || '',
      matrix_name: mapped.matrix_name || '',
      sampling_point_count: pointCount,
      parameters: mapped.parameters || '',
      applicable_regulation: mapped.applicable_regulation || '',
      assigned_personnel: mapped.assigned_personnel || '',
      notes: mapped.notes || '',
    };

    const missingFields: string[] = [];
    if (!extractedData.document_number) missingFields.push('document_number');
    if (!extractedData.customer_name) missingFields.push('customer_name');
    if (!extractedData.matrix_name) missingFields.push('matrix_name');
    if (!extractedData.parameters) missingFields.push('parameters');

    const warnings: string[] = [];
    if (!extractedData.sampling_date) {
      warnings.push('Tanggal sampling tidak ditemukan pada baris ini.');
    }
    if (!extractedData.applicable_regulation) {
      warnings.push('Regulasi baku mutu belum terisi.');
    }

    return {
      extractedData,
      missingFields,
      warnings,
    };
  });
}
