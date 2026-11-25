import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManualOverrideStatus,
  evaluatePersonnelAvailability,
  recommendPersonnel,
  validateVehicleReservation,
  type AssignmentWindow,
  type LeaveWindow,
  type PersonnelProfile,
  type VehicleProfile,
  type VehicleReservationWindow,
} from './scheduling';
import {
  detectSpsDuplicate,
  evaluateSpsArchivalLifecycle,
  formatSamplingDateRangeLabel,
  formatSpsNumber,
  mapExcelRowsToSpsRecords,
} from './sps';

const basePerson1: PersonnelProfile = {
  id: 'p-1',
  code: 'EMP-001',
  fullName: 'Budi Santoso',
  category: 'INTERNAL',
  baseLocation: 'Bogor',
  employmentStatus: 'ACTIVE',
  fieldEligible: true,
  competencyIds: ['comp-wastewater', 'comp-surfacewater'],
};

const basePerson2: PersonnelProfile = {
  id: 'p-2',
  code: 'FRL-001',
  fullName: 'Rizky Ramadhan',
  category: 'EXTERNAL',
  baseLocation: 'Jakarta',
  employmentStatus: 'ACTIVE',
  fieldEligible: true,
  competencyIds: ['comp-wastewater'],
};

const unverifiedFreelancer: PersonnelProfile = {
  id: 'p-3',
  code: 'FRL-002',
  fullName: 'Taufik Hidayat',
  category: 'EXTERNAL',
  baseLocation: 'Bogor',
  employmentStatus: 'ACTIVE',
  fieldEligible: false,
  competencyIds: ['comp-wastewater'],
};

test('Scenario 6: Confirmed assignment conflict detection includes mobilization/return buffers', () => {
  const existing: AssignmentWindow[] = [
    {
      id: 'a-1',
      requestId: 'req-1',
      scheduleId: 'sch-1',
      personnelId: 'p-1',
      assignmentStatus: 'CONFIRMED',
      startDate: new Date('2026-11-28T08:00:00Z'),
      endDate: new Date('2026-11-28T16:00:00Z'),
      mobilizationBufferHours: 2,
      returnBufferHours: 2,
      jobName: 'Monitoring Air Limbah Hotel Pakuan',
    },
  ];

  const evalConflict = evaluatePersonnelAvailability({
    person: basePerson1,
    targetStart: new Date('2026-11-28T17:00:00Z'), // overlaps 2h return buffer (until 18:00Z)
    targetEnd: new Date('2026-11-28T20:00:00Z'),
    assignments: existing,
    leaves: [],
    manualRecords: [],
    requiredCompetencyIds: ['comp-wastewater'],
  });

  assert.equal(evalConflict.status, 'CONFLICT');
  assert.equal(evalConflict.hasConfirmedConflict, true);
  assert.equal(canManualOverrideStatus(evalConflict).allowed, false);
});

test('Scenario 4 & 5: Automatic recommendation ranks qualified available personnel & excludes unverified freelancers', () => {
  const leaves: LeaveWindow[] = [];
  const ranked = recommendPersonnel({
    allPersonnel: [unverifiedFreelancer, basePerson2, basePerson1],
    assignments: [],
    leaves,
    manualRecords: [],
    targetStart: new Date('2026-12-01T08:00:00Z'),
    targetEnd: new Date('2026-12-01T16:00:00Z'),
    requiredCompetencyIds: ['comp-wastewater'],
    targetLocation: 'Bogor, Jawa Barat',
  });

  assert.equal(ranked[0].personnel.id, 'p-1');
  assert.equal(ranked[0].eligible, true);
  assert.equal(ranked[1].personnel.id, 'p-2');
  assert.equal(ranked[1].eligible, true);
  const excluded = ranked.find((r) => r.personnel.id === 'p-3')!;
  assert.equal(excluded.eligible, false);
  assert.ok(excluded.exclusionReasons.some((r) => r.includes('belum diverifikasi')));
});

test('Scenario 7: Vehicle reservation rejects overlapping schedules, capacity overflow, and driver overlap', () => {
  const vehicle: VehicleProfile = {
    id: 'v-1',
    vehicleCode: 'VEH-01',
    registrationNumber: 'F 1234 ANK',
    model: 'Toyota Hilux Double Cabin',
    passengerCapacity: 4,
    operationalStatus: 'AVAILABLE',
    baseLocation: 'Bogor',
  };

  const existingReservations: VehicleReservationWindow[] = [
    {
      id: 'vr-1',
      vehicleId: 'v-1',
      scheduleId: 'sch-1',
      driverPersonnelId: 'p-1',
      departureTime: new Date('2026-12-02T07:00:00Z'),
      returnTime: new Date('2026-12-02T17:00:00Z'),
      status: 'RESERVED',
      destination: 'Cikarang',
    },
  ];

  const driverAssignments: AssignmentWindow[] = [
    {
      id: 'a-2',
      requestId: 'req-2',
      scheduleId: 'sch-2',
      personnelId: 'p-2',
      assignmentStatus: 'CONFIRMED',
      startDate: new Date('2026-12-03T08:00:00Z'),
      endDate: new Date('2026-12-03T16:00:00Z'),
    },
  ];

  const overlapResult = validateVehicleReservation({
    vehicle,
    existingReservations,
    driverAssignments,
    departureTime: new Date('2026-12-02T10:00:00Z'),
    returnTime: new Date('2026-12-02T14:00:00Z'),
    passengerCount: 5,
    driverPersonnelId: 'p-1',
  });

  assert.equal(overlapResult.valid, false);
  assert.ok(overlapResult.errors.some((e) => e.includes('Kapasitas penumpang')));
  assert.ok(overlapResult.errors.some((e) => e.includes('sudah direservasi')));

  const driverOverlap = validateVehicleReservation({
    vehicle,
    existingReservations,
    driverAssignments,
    departureTime: new Date('2026-12-03T09:00:00Z'),
    returnTime: new Date('2026-12-03T15:00:00Z'),
    passengerCount: 3,
    driverPersonnelId: 'p-2',
  });

  assert.equal(driverOverlap.valid, false);
  assert.ok(driverOverlap.errors.some((e) => e.includes('Pengemudi memiliki penugasan')));
});

test('Scenario 10, 11, 13: SPS archival lifecycle prompts only after latest approved schedule & respects deferral/postponement', () => {
  const now = new Date('2026-11-25T10:00:00Z');

  // Original passed, but postponed to Dec 10 -> must NOT trigger archival
  const postponed = evaluateSpsArchivalLifecycle({
    spsNumber: '001/SPS/AKL/XI/2026',
    lifecycleStatus: 'ACTIVE',
    originalEndDate: new Date('2026-11-20T17:00:00Z'),
    latestApprovedScheduleEndDate: new Date('2026-12-10T17:00:00Z'),
    archivalDeferredUntil: null,
    now,
  });
  assert.equal(postponed.shouldPromptArchival, false);
  assert.equal(postponed.recommendedStatus, 'ACTIVE');

  // Passed and not postponed -> triggers YES/NO prompt
  const passed = evaluateSpsArchivalLifecycle({
    spsNumber: '002/SPS/AKL/XI/2026',
    lifecycleStatus: 'ACTIVE',
    originalEndDate: new Date('2026-11-20T17:00:00Z'),
    latestApprovedScheduleEndDate: new Date('2026-11-20T17:00:00Z'),
    archivalDeferredUntil: null,
    now,
  });
  assert.equal(passed.shouldPromptArchival, true);
  assert.equal(passed.recommendedStatus, 'PENDING_ARCHIVAL');

  // User clicked NO -> ARCHIVAL_DEFERRED until Dec 2 -> should NOT prompt yet
  const deferred = evaluateSpsArchivalLifecycle({
    spsNumber: '002/SPS/AKL/XI/2026',
    lifecycleStatus: 'ARCHIVAL_DEFERRED',
    originalEndDate: new Date('2026-11-20T17:00:00Z'),
    latestApprovedScheduleEndDate: new Date('2026-11-20T17:00:00Z'),
    archivalDeferredUntil: new Date('2026-12-02T00:00:00Z'),
    now,
  });
  assert.equal(deferred.shouldPromptArchival, false);
  assert.equal(deferred.recommendedStatus, 'ARCHIVAL_DEFERRED');
});

test('SPS automatic numbering, Excel mapping, and duplicate detection', () => {
  const num = formatSpsNumber(
    '{SEQ}/SPS/AKL/{ROMAN_MONTH}/{YEAR}',
    22,
    new Date('2026-10-08T00:00:00Z')
  );
  assert.equal(num, '022/SPS/AKL/X/2026');

  const mapped = mapExcelRowsToSpsRecords(
    [
      {
        'No SPS': '027/SPS/AKL/X/2026',
        Pelanggan: 'RS Medika Bogor',
        Matriks: 'Air Limbah',
        Parameter: 'pH, BOD, COD, TSS',
        'Jumlah Titik': '2',
      },
      {
        'No SPS': '',
        Pelanggan: 'PT Tanpa Matriks',
      },
    ],
    {}
  );

  assert.equal(mapped[0].missingFields.length, 0);
  assert.equal(mapped[0].extractedData.sampling_point_count, 2);
  assert.ok(mapped[1].missingFields.includes('document_number'));
  assert.ok(mapped[1].missingFields.includes('matrix_name'));

  const dup = detectSpsDuplicate(
    {
      spsNumber: '027/SPS/AKL/X/2026',
      customerName: 'RS Medika Bogor',
      jobName: 'Pemantauan Lingkungan',
      samplingDateLabel: '22 Oktober 2026',
    },
    [
      {
        id: 'sps-1',
        spsNumber: '027/SPS/AKL/X/2026',
        customerName: 'RS Medika Bogor',
        jobName: 'Pemantauan Lingkungan',
        samplingDateLabel: '22 Oktober 2026',
      },
    ]
  );
  assert.equal(dup.duplicateStatus, 'EXACT_NUMBER_DUPLICATE');
});

test('Sampling date range formatting handles single day, same month, multi-month, and cross-year ranges', () => {
  assert.equal(
    formatSamplingDateRangeLabel(new Date('2026-10-24T08:00:00Z'), new Date('2026-10-24T16:00:00Z')),
    '24 Oktober 2026'
  );
  assert.equal(
    formatSamplingDateRangeLabel(new Date('2026-10-24T08:00:00Z'), new Date('2026-10-28T17:00:00Z')),
    '24 - 28 Oktober 2026'
  );
  assert.equal(
    formatSamplingDateRangeLabel(new Date('2026-10-24T08:00:00Z'), new Date('2026-11-30T17:00:00Z')),
    '24 Oktober - 30 November 2026'
  );
  assert.equal(
    formatSamplingDateRangeLabel(new Date('2026-12-28T08:00:00Z'), new Date('2027-01-04T17:00:00Z')),
    '28 Desember 2026 - 04 Januari 2027'
  );
});
