export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'TENTATIVE'
  | 'ASSIGNED'
  | 'UNAVAILABLE'
  | 'ON_LEAVE'
  | 'CONFLICT';

export interface PersonnelProfile {
  id: string;
  code: string;
  fullName: string;
  category: 'INTERNAL' | 'EXTERNAL';
  departmentId?: string | null;
  baseLocation: string;
  employmentStatus: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  fieldEligible: boolean;
  competencyIds: string[];
}

export interface AssignmentWindow {
  id: string;
  requestId: string;
  scheduleId: string;
  personnelId: string;
  assignmentStatus: 'TENTATIVE' | 'CONFIRMED' | 'REPLACED' | 'CANCELLED';
  startDate: Date;
  endDate: Date;
  mobilizationBufferHours?: number;
  returnBufferHours?: number;
  jobName?: string;
}

export interface LeaveWindow {
  id: string;
  personnelId: string;
  startDate: Date;
  endDate: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  leaveType: string;
  reason?: string;
}

export interface ManualAvailabilityWindow {
  id: string;
  personnelId: string;
  startDate: Date;
  endDate: Date;
  status: 'AVAILABLE' | 'TENTATIVE' | 'ASSIGNED' | 'UNAVAILABLE' | 'ON_LEAVE';
  source: 'MANUAL' | 'SYSTEM' | 'LEAVE';
  reason?: string;
}

export interface AvailabilityEvaluation {
  personnelId: string;
  status: AvailabilityStatus;
  source: string;
  hasConfirmedConflict: boolean;
  reasons: string[];
  conflictingAssignments: AssignmentWindow[];
  activeWorkloadCount: number;
}

export interface RecommendationCandidate {
  personnel: PersonnelProfile;
  score: number;
  eligible: boolean;
  availability: AvailabilityEvaluation;
  inclusionReasons: string[];
  exclusionReasons: string[];
}

export interface VehicleProfile {
  id: string;
  vehicleCode: string;
  registrationNumber: string;
  model: string;
  passengerCapacity: number;
  operationalStatus: 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'UNAVAILABLE';
  baseLocation: string;
}

export interface VehicleReservationWindow {
  id: string;
  vehicleId: string;
  scheduleId: string;
  driverPersonnelId?: string | null;
  departureTime: Date;
  returnTime: Date;
  status: 'RESERVED' | 'IN_USE' | 'COMPLETED' | 'CANCELLED';
  destination?: string;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600 * 1000);
}

export function hasTimeOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function evaluatePersonnelAvailability(params: {
  person: PersonnelProfile;
  targetStart: Date;
  targetEnd: Date;
  mobilizationBufferHours?: number;
  returnBufferHours?: number;
  assignments: AssignmentWindow[];
  leaves: LeaveWindow[];
  manualRecords: ManualAvailabilityWindow[];
  requiredCompetencyIds?: string[];
  excludeScheduleId?: string;
}): AvailabilityEvaluation {
  const {
    person,
    targetStart,
    targetEnd,
    mobilizationBufferHours = 2,
    returnBufferHours = 2,
    assignments,
    leaves,
    manualRecords,
    requiredCompetencyIds = [],
    excludeScheduleId,
  } = params;

  const effectiveTargetStart = addHours(targetStart, -mobilizationBufferHours);
  const effectiveTargetEnd = addHours(targetEnd, returnBufferHours);

  const reasons: string[] = [];
  const conflictingAssignments: AssignmentWindow[] = [];

  if (person.employmentStatus !== 'ACTIVE') {
    reasons.push(`Status kepegawaian tidak aktif (${person.employmentStatus})`);
    return {
      personnelId: person.id,
      status: 'UNAVAILABLE',
      source: 'STATUS_KEPEGAWAIAN',
      hasConfirmedConflict: true,
      reasons,
      conflictingAssignments,
      activeWorkloadCount: 0,
    };
  }

  if (!person.fieldEligible) {
    reasons.push(
      person.category === 'EXTERNAL'
        ? 'Personel eksternal belum diverifikasi kelayakan operasional oleh SPV Sampling'
        : 'Personel tidak memenuhi syarat penugasan lapangan'
    );
    return {
      personnelId: person.id,
      status: 'UNAVAILABLE',
      source: 'KELAYAKAN_OPERASIONAL',
      hasConfirmedConflict: true,
      reasons,
      conflictingAssignments,
      activeWorkloadCount: 0,
    };
  }

  const personAssignments = assignments.filter(
    (a) =>
      a.personnelId === person.id &&
      a.assignmentStatus !== 'REPLACED' &&
      a.assignmentStatus !== 'CANCELLED' &&
      (!excludeScheduleId || a.scheduleId !== excludeScheduleId)
  );

  const confirmedConflicts = personAssignments.filter((a) => {
    if (a.assignmentStatus !== 'CONFIRMED') return false;
    const aStart = addHours(a.startDate, -(a.mobilizationBufferHours ?? 2));
    const aEnd = addHours(a.endDate, a.returnBufferHours ?? 2);
    return hasTimeOverlap(effectiveTargetStart, effectiveTargetEnd, aStart, aEnd);
  });

  const tentativeOverlaps = personAssignments.filter((a) => {
    if (a.assignmentStatus !== 'TENTATIVE') return false;
    const aStart = addHours(a.startDate, -(a.mobilizationBufferHours ?? 2));
    const aEnd = addHours(a.endDate, a.returnBufferHours ?? 2);
    return hasTimeOverlap(effectiveTargetStart, effectiveTargetEnd, aStart, aEnd);
  });

  const approvedLeave = leaves.find(
    (l) =>
      l.personnelId === person.id &&
      l.status === 'APPROVED' &&
      hasTimeOverlap(targetStart, targetEnd, l.startDate, l.endDate)
  );

  if (approvedLeave) {
    reasons.push(`Sedang cuti/izin (${approvedLeave.leaveType}): ${approvedLeave.reason || 'Disetujui'}`);
    return {
      personnelId: person.id,
      status: 'ON_LEAVE',
      source: 'CUTI_DISETUJUI',
      hasConfirmedConflict: true,
      reasons,
      conflictingAssignments: confirmedConflicts,
      activeWorkloadCount: personAssignments.length,
    };
  }

  if (confirmedConflicts.length > 0) {
    conflictingAssignments.push(...confirmedConflicts);
    reasons.push(
      `Bentrok jadwal terkonfirmasi (${confirmedConflicts
        .map((c) => c.jobName || c.scheduleId)
        .join(', ')}) termasuk buffer mobilisasi`
    );
    return {
      personnelId: person.id,
      status: 'CONFLICT',
      source: 'OTOMATIS_JADWAL_TERKONFIRMASI',
      hasConfirmedConflict: true,
      reasons,
      conflictingAssignments,
      activeWorkloadCount: personAssignments.length,
    };
  }

  const manualBlock = manualRecords.find(
    (m) =>
      m.personnelId === person.id &&
      m.status === 'UNAVAILABLE' &&
      hasTimeOverlap(targetStart, targetEnd, m.startDate, m.endDate)
  );
  if (manualBlock) {
    reasons.push(`Ditandai tidak tersedia secara manual: ${manualBlock.reason || 'Konfirmasi SPV'}`);
    return {
      personnelId: person.id,
      status: 'UNAVAILABLE',
      source: `KONFIRMASI_${manualBlock.source}`,
      hasConfirmedConflict: true,
      reasons,
      conflictingAssignments: [],
      activeWorkloadCount: personAssignments.length,
    };
  }

  if (tentativeOverlaps.length > 0) {
    conflictingAssignments.push(...tentativeOverlaps);
    reasons.push(`Memiliki penugasan tentatif pada rentang waktu yang beririsan`);
    return {
      personnelId: person.id,
      status: 'TENTATIVE',
      source: 'OTOMATIS_JADWAL_TENTATIF',
      hasConfirmedConflict: false,
      reasons,
      conflictingAssignments,
      activeWorkloadCount: personAssignments.length,
    };
  }

  const manualAvail = manualRecords.find(
    (m) =>
      m.personnelId === person.id &&
      m.status === 'AVAILABLE' &&
      hasTimeOverlap(targetStart, targetEnd, m.startDate, m.endDate)
  );

  const missingComp = requiredCompetencyIds.filter(
    (cid) => !person.competencyIds.includes(cid)
  );
  if (missingComp.length > 0) {
    reasons.push(`Tidak memiliki semua kompetensi matriks yang dipersyaratkan`);
  }

  if (manualAvail) {
    reasons.push(`Tersedia (terkonfirmasi manual: ${manualAvail.reason || 'Siap tugas'})`);
    return {
      personnelId: person.id,
      status: 'AVAILABLE',
      source: 'KONFIRMASI_MANUAL',
      hasConfirmedConflict: false,
      reasons,
      conflictingAssignments: [],
      activeWorkloadCount: personAssignments.length,
    };
  }

  reasons.push('Tersedia berdasarkan perhitungan kalender, cuti, dan penugasan aktif');
  return {
    personnelId: person.id,
    status: 'AVAILABLE',
    source: 'PERHITUNGAN_OTOMATIS',
    hasConfirmedConflict: false,
    reasons,
    conflictingAssignments: [],
    activeWorkloadCount: personAssignments.length,
  };
}

export function canManualOverrideStatus(
  evaluation: AvailabilityEvaluation
): { allowed: boolean; reason?: string } {
  if (evaluation.hasConfirmedConflict && evaluation.status === 'CONFLICT') {
    return {
      allowed: false,
      reason:
        'Konfirmasi manual tidak dapat menimpa bentrok penugasan terkonfirmasi yang sudah ada.',
    };
  }
  return { allowed: true };
}

export function recommendPersonnel(params: {
  allPersonnel: PersonnelProfile[];
  assignments: AssignmentWindow[];
  leaves: LeaveWindow[];
  manualRecords: ManualAvailabilityWindow[];
  targetStart: Date;
  targetEnd: Date;
  requiredCompetencyIds: string[];
  targetLocation: string;
  requiredTeamSize?: number;
  excludeScheduleId?: string;
}): RecommendationCandidate[] {
  const {
    allPersonnel,
    assignments,
    leaves,
    manualRecords,
    targetStart,
    targetEnd,
    requiredCompetencyIds,
    targetLocation,
    excludeScheduleId,
  } = params;

  const normalizedLoc = targetLocation.toLowerCase();

  const results: RecommendationCandidate[] = allPersonnel.map((person) => {
    const availability = evaluatePersonnelAvailability({
      person,
      targetStart,
      targetEnd,
      assignments,
      leaves,
      manualRecords,
      requiredCompetencyIds,
      excludeScheduleId,
    });

    const inclusionReasons: string[] = [];
    const exclusionReasons: string[] = [];
    let score = 0;

    if (availability.status === 'AVAILABLE') {
      score += 40;
      inclusionReasons.push('Tersedia pada tanggal pelaksanaan yang diminta');
    } else if (availability.status === 'TENTATIVE') {
      score += 15;
      inclusionReasons.push('Tersedia dengan catatan penugasan tentatif lain');
    } else {
      exclusionReasons.push(...availability.reasons);
    }

    const matchedCompetencies = requiredCompetencyIds.filter((cid) =>
      person.competencyIds.includes(cid)
    );
    if (requiredCompetencyIds.length === 0 || matchedCompetencies.length === requiredCompetencyIds.length) {
      score += 30;
      inclusionReasons.push('Memiliki seluruh kompetensi matriks sampling yang dipersyaratkan');
    } else if (matchedCompetencies.length > 0) {
      score += 12;
      exclusionReasons.push(
        `Hanya memenuhi ${matchedCompetencies.length}/${requiredCompetencyIds.length} kompetensi matriks`
      );
    } else {
      exclusionReasons.push('Tidak memiliki kompetensi matriks yang dibutuhkan');
    }

    if (!availability.hasConfirmedConflict) {
      inclusionReasons.push('Tidak ada bentrok penugasan atau cuti');
      score += 10;
    }

    const workloadScore = Math.max(0, 15 - availability.activeWorkloadCount * 3);
    score += workloadScore;
    if (availability.activeWorkloadCount <= 2) {
      inclusionReasons.push(`Beban kerja relatif rendah (${availability.activeWorkloadCount} penugasan aktif)`);
    }

    const personLoc = person.baseLocation.toLowerCase();
    if (
      normalizedLoc.includes(personLoc) ||
      personLoc.includes(normalizedLoc) ||
      (normalizedLoc.includes('bogor') && personLoc.includes('jabodetabek'))
    ) {
      score += 10;
      inclusionReasons.push(`Lokasi basis (${person.baseLocation}) dekat / sesuai lokasi sampling`);
    }

    if (person.category === 'INTERNAL') {
      score += 5;
    }

    const eligible =
      (availability.status === 'AVAILABLE' || availability.status === 'TENTATIVE') &&
      (requiredCompetencyIds.length === 0 || matchedCompetencies.length > 0) &&
      person.employmentStatus === 'ACTIVE' &&
      person.fieldEligible;

    return {
      personnel: person,
      score: eligible ? score : Math.max(0, score - 50),
      eligible,
      availability,
      inclusionReasons,
      exclusionReasons,
    };
  });

  return results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.score - a.score;
  });
}

export function validateVehicleReservation(params: {
  vehicle: VehicleProfile;
  existingReservations: VehicleReservationWindow[];
  driverAssignments: AssignmentWindow[];
  departureTime: Date;
  returnTime: Date;
  passengerCount: number;
  driverPersonnelId?: string | null;
  excludeScheduleId?: string;
}): { valid: boolean; errors: string[] } {
  const {
    vehicle,
    existingReservations,
    driverAssignments,
    departureTime,
    returnTime,
    passengerCount,
    driverPersonnelId,
    excludeScheduleId,
  } = params;

  const errors: string[] = [];

  if (vehicle.operationalStatus === 'MAINTENANCE' || vehicle.operationalStatus === 'UNAVAILABLE') {
    errors.push(
      `Kendaraan ${vehicle.registrationNumber} sedang berstatus ${vehicle.operationalStatus}`
    );
  }

  if (passengerCount > vehicle.passengerCapacity) {
    errors.push(
      `Kapasitas penumpang kendaraan (${vehicle.passengerCapacity} orang) tidak mencukupi untuk tim (${passengerCount} orang)`
    );
  }

  const overlappingVehicle = existingReservations.filter(
    (r) =>
      r.vehicleId === vehicle.id &&
      r.status !== 'CANCELLED' &&
      r.status !== 'COMPLETED' &&
      (!excludeScheduleId || r.scheduleId !== excludeScheduleId) &&
      hasTimeOverlap(departureTime, returnTime, r.departureTime, r.returnTime)
  );

  if (overlappingVehicle.length > 0) {
    errors.push(
      `Kendaraan ${vehicle.registrationNumber} sudah direservasi pada rentang waktu tersebut (${overlappingVehicle
        .map((o) => o.destination || o.scheduleId)
        .join(', ')})`
    );
  }

  if (driverPersonnelId) {
    const overlappingDriver = driverAssignments.filter(
      (a) =>
        a.personnelId === driverPersonnelId &&
        a.assignmentStatus === 'CONFIRMED' &&
        (!excludeScheduleId || a.scheduleId !== excludeScheduleId) &&
        hasTimeOverlap(departureTime, returnTime, a.startDate, a.endDate)
    );
    if (overlappingDriver.length > 0) {
      errors.push(
        `Pengemudi memiliki penugasan lapangan terkonfirmasi lain yang bentrok pada waktu keberangkatan`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
