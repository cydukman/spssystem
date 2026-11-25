import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  availabilityRecords,
  certifications,
  competencies,
  customers,
  departments,
  documentArchives,
  documentEvents,
  leaveRequests,
  matrices,
  notifications,
  parameters,
  personnel,
  personnelAssignments,
  personnelCompetencies,
  regulations,
  requestApprovals,
  requestMatrices,
  requestMatrixParameters,
  samplingRequests,
  samplingSchedules,
  spsDocuments,
  spsRevisions,
  spsTemplates,
  systemSettings,
  vehicleReservations,
  vehicles,
} from '../db/schema.ts';

export async function ensureMasterAndDemoData(actorUserId?: string, forceResetDemo = false) {
  if (forceResetDemo) {
    // Delete only demo operational records (never touch user-created production records!)
    await db.delete(notifications).where(eq(notifications.isDemo, true));
    await db.delete(vehicleReservations).where(eq(vehicleReservations.isDemo, true));
    await db.delete(personnelAssignments).where(eq(personnelAssignments.isDemo, true));
    await db.delete(spsTemplates).where(eq(spsTemplates.isDemo, true));
    await db.delete(spsDocuments).where(eq(spsDocuments.isDemo, true));
    await db.delete(samplingSchedules).where(eq(samplingSchedules.isDemo, true));
    await db.delete(samplingRequests).where(eq(samplingRequests.isDemo, true));
    await db.delete(availabilityRecords).where(eq(availabilityRecords.isDemo, true));
    await db.delete(leaveRequests).where(eq(leaveRequests.isDemo, true));
    await db.delete(vehicles).where(eq(vehicles.isDemo, true));
    await db.delete(personnel).where(eq(personnel.isDemo, true));
    await db.delete(customers).where(eq(customers.isDemo, true));
  }

  // Check if master data exists
  const existingDepts = await db.select().from(departments).limit(1);
  if (existingDepts.length === 0) {
    await db
      .insert(departments)
      .values([
        { code: 'SMP', name: 'Sampling Lapangan', description: 'Tim pengambil contoh uji lapangan' },
        { code: 'KAE', name: 'KAE & Pemasaran', description: 'Key Account Executive & Penjualan' },
        { code: 'LAB', name: 'Laboratorium Pengujian', description: 'Divisi Analisis Lingkungan' },
        { code: 'MGT', name: 'Manajemen Operasional', description: 'Direksi & Pengawasan Mutu' },
      ])
      .onConflictDoNothing();
  }

  const allDepts = await db.select().from(departments);
  const deptSampling = allDepts.find((d) => d.code === 'SMP')?.id || allDepts[0]?.id;

  // Settings
  const defaultSettings = [
    {
      key: 'sps_number_format',
      value: { pattern: '{SEQ}/SPS/AKL/{ROMAN_MONTH}/{YEAR}', nextSequence: 1 },
      description: 'Format penomoran otomatis dokumen SPS ANKAL-FO-7.1-01',
    },
    {
      key: 'archival_policy',
      value: { deferIntervalDays: 7, autoPromptOnPastSchedule: true },
      description: 'Kebijakan notifikasi pengarsipan pasca jadwal sampling',
    },
    {
      key: 'scheduling_buffers',
      value: { mobilizationBufferHours: 2, returnBufferHours: 2, allowTentativeOverlap: true },
      description: 'Buffer mobilisasi/kepulangan standar dalam jam',
    },
  ];
  for (const s of defaultSettings) {
    await db.insert(systemSettings).values(s).onConflictDoNothing();
  }

  // Competencies
  const compSeed = [
    { code: 'COMP-WW', name: 'Sampling Air Limbah & Domestik', matrixCategory: 'Air Limbah', description: 'SNI 6989.59:2008 Pengambilan Contoh Air Limbah' },
    { code: 'COMP-SW', name: 'Sampling Air Permukaan, Tanah & Laut', matrixCategory: 'Air Permukaan', description: 'SNI 6989.57:2008 Air Permukaan & Tanah' },
    { code: 'COMP-EM', name: 'Sampling Emisi Sumber Tidak Bergerak', matrixCategory: 'Emisi', description: 'Isokinetik & Pengukuran Cerobong / Genset' },
    { code: 'COMP-AA', name: 'Sampling Udara Ambien, Kebisingan & Getaran', matrixCategory: 'Udara Ambien', description: 'HVAS, Gas Impinger, Sound Level Meter' },
    { code: 'COMP-SL', name: 'Sampling Tanah, Sedimen & Limbah B3 (TCLP)', matrixCategory: 'Tanah & Padatan', description: 'Pengambilan sampel padatan & sludge' },
    { code: 'COMP-BIO', name: 'Sampling Biota Perairan (Plankton & Benthos)', matrixCategory: 'Biota Perairan', description: 'Identifikasi dan sampling ekologi perairan' },
  ];
  for (const c of compSeed) {
    await db.insert(competencies).values(c).onConflictDoNothing();
  }
  const allComps = await db.select().from(competencies);
  const compByCode = new Map(allComps.map((c) => [c.code, c]));

  // Matrices
  const matrixSeed = [
    { code: 'MTX-WW', name: 'Air Limbah (Wastewater)', category: 'Air Limbah', requiredCompetencyId: compByCode.get('COMP-WW')?.id, description: 'Air limbah industri maupun domestik' },
    { code: 'MTX-DWW', name: 'Air Limbah Domestik', category: 'Air Limbah', requiredCompetencyId: compByCode.get('COMP-WW')?.id, description: 'IPAL Domestik gedung/hotel/RS' },
    { code: 'MTX-SW', name: 'Air Permukaan (Surface Water)', category: 'Air Permukaan', requiredCompetencyId: compByCode.get('COMP-SW')?.id, description: 'Sungai, danau, dan badan air' },
    { code: 'MTX-GW', name: 'Air Tanah (Groundwater)', category: 'Air Permukaan', requiredCompetencyId: compByCode.get('COMP-SW')?.id, description: 'Sumur pantau & sumur bor' },
    { code: 'MTX-EM', name: 'Emisi Sumber Tidak Bergerak', category: 'Emisi', requiredCompetencyId: compByCode.get('COMP-EM')?.id, description: 'Cerobong, genset, boiler, incinerator' },
    { code: 'MTX-AA', name: 'Udara Ambien & Kebisingan', category: 'Udara Ambien', requiredCompetencyId: compByCode.get('COMP-AA')?.id, description: 'Kualitas udara ambien 24 jam & kebisingan' },
    { code: 'MTX-SL', name: 'Tanah / Sludge TCLP', category: 'Tanah & Padatan', requiredCompetencyId: compByCode.get('COMP-SL')?.id, description: 'Analisis tanah dan limbah padatan' },
    { code: 'MTX-BIO', name: 'Biota Perairan (Plankton & Benthos)', category: 'Biota Perairan', requiredCompetencyId: compByCode.get('COMP-BIO')?.id, description: 'Plankton, nekton, dan benthos' },
  ];
  for (const m of matrixSeed) {
    await db.insert(matrices).values(m).onConflictDoNothing();
  }

  // Parameters
  const paramSeed = [
    { code: 'PRM-PH', name: 'pH', unit: '-', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 6989.11:2019' },
    { code: 'PRM-BOD', name: 'BOD5', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 6989.72:2009' },
    { code: 'PRM-COD', name: 'COD', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 6989.2:2019' },
    { code: 'PRM-TSS', name: 'TSS', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 6989.3:2019' },
    { code: 'PRM-OG', name: 'Minyak & Lemak', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 6989.10:2011' },
    { code: 'PRM-NH3', name: 'Amoniak (NH3-N)', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'SNI 06-6989.30-2005' },
    { code: 'PRM-TCOL', name: 'Total Coliform', unit: 'MPN/100mL', matrixCategory: 'Air Limbah', isSubcontractDefault: true, method: 'Subkontrak Terakreditasi' },
    { code: 'PRM-FCOL', name: 'Fecal Coliform', unit: 'MPN/100mL', matrixCategory: 'Air Limbah', isSubcontractDefault: true, method: 'Subkontrak Terakreditasi' },
    { code: 'PRM-CL2', name: 'Klorin Bebas (Cl2)', unit: 'mg/L', matrixCategory: 'Air Limbah', isSubcontractDefault: false, method: 'Spektrofotometri' },
    { code: 'PRM-DO', name: 'Oksigen Terlarut (DO)', unit: 'mg/L', matrixCategory: 'Air Permukaan', isSubcontractDefault: false, method: 'SNI 06-6989.14-2004' },
    { code: 'PRM-PB', name: 'Timbal (Pb)', unit: 'mg/L', matrixCategory: 'Air Permukaan', isSubcontractDefault: false, method: 'ICP-OES' },
    { code: 'PRM-FE', name: 'Besi (Fe)', unit: 'mg/L', matrixCategory: 'Air Permukaan', isSubcontractDefault: false, method: 'ICP-OES' },
    { code: 'PRM-SO2', name: 'Sulfur Dioksida (SO2)', unit: 'µg/Nm³', matrixCategory: 'Udara Ambien', isSubcontractDefault: false, method: 'Pararosanilin' },
    { code: 'PRM-NO2', name: 'Nitrogen Dioksida (NO2)', unit: 'µg/Nm³', matrixCategory: 'Udara Ambien', isSubcontractDefault: false, method: 'Griess-Saltzman' },
    { code: 'PRM-PM10', name: 'Partikulat PM10', unit: 'µg/Nm³', matrixCategory: 'Udara Ambien', isSubcontractDefault: false, method: 'Gravimetri' },
    { code: 'PRM-NOISE', name: 'Kebisingan 24 Jam', unit: 'dBA', matrixCategory: 'Udara Ambien', isSubcontractDefault: false, method: 'KepmenLH 48/1996' },
    { code: 'PRM-PART', name: 'Total Partikulat (Isokinetik)', unit: 'mg/Nm³', matrixCategory: 'Emisi', isSubcontractDefault: false, method: 'SNI 7117.17:2009' },
    { code: 'PRM-CO', name: 'Karbon Monoksida (CO)', unit: 'mg/Nm³', matrixCategory: 'Emisi', isSubcontractDefault: false, method: 'Electrochemical' },
  ];
  for (const p of paramSeed) {
    await db.insert(parameters).values(p).onConflictDoNothing();
  }

  // Regulations
  const regSeed = [
    { code: 'REG-68-2016', name: 'PermenLHK No. P.68 Tahun 2016 (Air Limbah Domestik)', matrixCategory: 'Air Limbah', year: 2016, description: 'Baku Mutu Air Limbah Domestik' },
    { code: 'REG-5-2014', name: 'PermenLH No. 5 Tahun 2014 (Baku Mutu Air Limbah)', matrixCategory: 'Air Limbah', year: 2014, description: 'Baku Mutu Air Limbah Industri' },
    { code: 'REG-11-2025', name: 'PermenLHK No. 11 Tahun 2025 Lamp. I A.2', matrixCategory: 'Air Limbah', year: 2025, description: 'Baku Mutu Air Limbah Fasilitas Pelayanan' },
    { code: 'REG-PP22-VI', name: 'PP No. 22 Tahun 2021 Lampiran VI (Air Sungai Kelas II)', matrixCategory: 'Air Permukaan', year: 2021, description: 'Baku Mutu Air Nasional' },
    { code: 'REG-PP22-VII', name: 'PP No. 22 Tahun 2021 Lampiran VII (Udara Ambien)', matrixCategory: 'Udara Ambien', year: 2021, description: 'Baku Mutu Udara Ambien Nasional' },
    { code: 'REG-48-1996', name: 'KepmenLH No. 48 Tahun 1996 (Baku Tingkat Kebisingan)', matrixCategory: 'Udara Ambien', year: 1996, description: 'Kebisingan Lingkungan' },
    { code: 'REG-11-2021', name: 'PermenLHK No. 11 Tahun 2021 (Emisi Genset)', matrixCategory: 'Emisi', year: 2021, description: 'Baku Mutu Emisi Pembakaran Internal' },
    { code: 'REG-15-2019', name: 'PermenLHK No. 15 Tahun 2019 (Emisi Pembangkit Termal)', matrixCategory: 'Emisi', year: 2019, description: 'Emisi Sumber Tidak Bergerak' },
  ];
  for (const r of regSeed) {
    await db.insert(regulations).values(r).onConflictDoNothing();
  }

  // Only populate demo operational data when explicitly requested via Settings -> Reset Demo
  if (!forceResetDemo) {
    return { seeded: false, message: 'Data master siap digunakan.' };
  }

  // Customers (fictionalized demo entities)
  const insertedCustomers = await db
    .insert(customers)
    .values([
      {
        name: 'Hotel Lembah Pakuan Bogor',
        address: 'Jl. Pajajaran Indah No. 18, Bogor Timur, Jawa Barat',
        phone: '0251-8321400',
        picName: 'Bapak Hendra Wijaya',
        picPhone: '0812-8800-1122',
        email: 'engineering@lembahpakuan.co.id',
        industry: 'Perhotelan',
        isDemo: true,
      },
      {
        name: 'RS Sentosa Medika Bogor',
        address: 'Jl. Sholeh Iskandar No. 45, Tanah Sareal, Kota Bogor',
        phone: '0251-8390221',
        picName: 'Ibu Ratna Sari',
        picPhone: '0813-7744-5566',
        email: 'kesling@sentosamedika.id',
        industry: 'Rumah Sakit',
        isDemo: true,
      },
      {
        name: 'PT Nusantara Energi Lestari',
        address: 'Kawasan Industri Cikarang Barat Blok C-12, Bekasi',
        phone: '021-89904412',
        picName: 'Bapak Arif Budiman',
        picPhone: '0856-9123-4500',
        email: 'hse@nusantaraenergi.co.id',
        industry: 'Energi & Manufaktur',
        isDemo: true,
      },
      {
        name: 'PT Tambang Mineral Khatulistiwa',
        address: 'Site Morowali Utara, Sulawesi Tengah',
        phone: '-',
        picName: 'Bapak Dimas Prasetyo',
        picPhone: '0811-4455-8899',
        email: 'enviro@khatulistiwamineral.co.id',
        industry: 'Pertambangan',
        isDemo: true,
      },
      {
        name: 'PT Agro Sawit Sejahtera',
        address: 'Jl. Raya Pelabuhan Ketapang Km. 14, Kalimantan Barat',
        phone: '0534-3031900',
        picName: 'Ibu Nadia Putri',
        picPhone: '0812-6677-3344',
        email: 'sustainability@agrosawit.co.id',
        industry: 'Agribisnis',
        isDemo: true,
      },
    ])
    .returning();

  // Personnel (Internal + Freelance)
  const insertedPersonnel = await db
    .insert(personnel)
    .values([
      {
        code: 'EMP-001',
        category: 'INTERNAL',
        fullName: 'Budi Santoso',
        departmentId: deptSampling,
        position: 'Senior Sampling Officer',
        phone: '0812-1001-2001',
        email: 'budi.santoso@ankal.co.id',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Spesialis Air Limbah & Emisi Cerobong',
        isDemo: true,
      },
      {
        code: 'EMP-002',
        category: 'INTERNAL',
        fullName: 'Rina Kusuma',
        departmentId: deptSampling,
        position: 'Field Team Leader',
        phone: '0812-1001-2002',
        email: 'rina.kusuma@ankal.co.id',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Lead Sampling untuk Air Permukaan, Air Limbah & Biota',
        isDemo: true,
      },
      {
        code: 'EMP-003',
        category: 'INTERNAL',
        fullName: 'Dedi Pratama',
        departmentId: deptSampling,
        position: 'Sampling Officer & Driver',
        phone: '0812-1001-2003',
        email: 'dedi.pratama@ankal.co.id',
        baseLocation: 'Bekasi',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Memiliki SIM A/B1 aktif untuk armada lapangan',
        isDemo: true,
      },
      {
        code: 'EMP-004',
        category: 'INTERNAL',
        fullName: 'Andi Wijaya',
        departmentId: deptSampling,
        position: 'Emission Specialist',
        phone: '0812-1001-2004',
        email: 'andi.wijaya@ankal.co.id',
        baseLocation: 'Jakarta',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Sertifikasi K3 Ketinggian & Pengukuran Isokinetik',
        isDemo: true,
      },
      {
        code: 'EMP-005',
        category: 'INTERNAL',
        fullName: 'Hendra Gunawan',
        departmentId: deptSampling,
        position: 'Sampling Officer',
        phone: '0812-1001-2005',
        email: 'hendra.gunawan@ankal.co.id',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Fokus udara ambien, kebisingan, dan air limbah',
        isDemo: true,
      },
      {
        code: 'EMP-006',
        category: 'INTERNAL',
        fullName: 'Dewi Anggraini',
        departmentId: deptSampling,
        position: 'Environmental Ecologist',
        phone: '0812-1001-2006',
        email: 'dewi.anggraini@ankal.co.id',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Ahli Biota Perairan & Tanah/Sedimen',
        isDemo: true,
      },
      {
        code: 'FRL-001',
        category: 'EXTERNAL',
        fullName: 'Rizky Ramadhan',
        position: 'Freelance Field Technician',
        phone: '0857-2200-3301',
        email: 'rizky.field@gmail.com',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Freelancer terverifikasi untuk air limbah & udara ambien',
        isDemo: true,
      },
      {
        code: 'FRL-002',
        category: 'EXTERNAL',
        fullName: 'Bagus Setiawan',
        position: 'Freelance Emission Crew',
        phone: '0857-2200-3302',
        email: 'bagus.emisi@gmail.com',
        baseLocation: 'Cikarang',
        employmentStatus: 'ACTIVE',
        fieldEligible: true,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: 'Freelancer terverifikasi pendukung tim emisi cerobong',
        isDemo: true,
      },
      {
        code: 'FRL-003',
        category: 'EXTERNAL',
        fullName: 'Taufik Hidayat',
        position: 'Freelance Candidate',
        phone: '0857-2200-3303',
        email: 'taufik.h@gmail.com',
        baseLocation: 'Bogor',
        employmentStatus: 'ACTIVE',
        fieldEligible: false,
        notes: 'Menunggu verifikasi sertifikat K3 & kelayakan oleh SPV Sampling',
        isDemo: true,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const allPersonnel =
    insertedPersonnel.length > 0 ? insertedPersonnel : await db.select().from(personnel);

  const pByCode = new Map(allPersonnel.map((p) => [p.code, p]));
  const compWW = compByCode.get('COMP-WW')?.id;
  const compSW = compByCode.get('COMP-SW')?.id;
  const compEM = compByCode.get('COMP-EM')?.id;
  const compAA = compByCode.get('COMP-AA')?.id;
  const compSL = compByCode.get('COMP-SL')?.id;
  const compBIO = compByCode.get('COMP-BIO')?.id;

  const compLinks: Array<{ personnelId: string; competencyId: string; level: string }> = [];
  const addComp = (code: string, cId?: string, level = 'SENIOR') => {
    const p = pByCode.get(code);
    if (p && cId) compLinks.push({ personnelId: p.id, competencyId: cId, level });
  };

  addComp('EMP-001', compWW, 'LEAD');
  addComp('EMP-001', compEM, 'SENIOR');
  addComp('EMP-002', compWW, 'LEAD');
  addComp('EMP-002', compSW, 'LEAD');
  addComp('EMP-002', compBIO, 'SENIOR');
  addComp('EMP-003', compWW, 'SENIOR');
  addComp('EMP-003', compAA, 'SENIOR');
  addComp('EMP-004', compEM, 'LEAD');
  addComp('EMP-004', compAA, 'SENIOR');
  addComp('EMP-005', compAA, 'SENIOR');
  addComp('EMP-005', compWW, 'JUNIOR');
  addComp('EMP-006', compBIO, 'LEAD');
  addComp('EMP-006', compSL, 'SENIOR');
  addComp('EMP-006', compSW, 'SENIOR');
  addComp('FRL-001', compWW, 'SENIOR');
  addComp('FRL-001', compAA, 'JUNIOR');
  addComp('FRL-002', compEM, 'SENIOR');
  addComp('FRL-003', compWW, 'JUNIOR');

  if (compLinks.length > 0) {
    await db.insert(personnelCompetencies).values(
      compLinks.map((cl) => ({
        personnelId: cl.personnelId,
        competencyId: cl.competencyId,
        verified: true,
        level: cl.level,
      }))
    );
  }

  // Certifications
  const budi = pByCode.get('EMP-001');
  const andi = pByCode.get('EMP-004');
  const rina = pByCode.get('EMP-002');
  if (budi && andi && rina) {
    await db.insert(certifications).values([
      {
        personnelId: budi.id,
        name: 'PPCU (Petugas Pengambil Contoh Uji Air)',
        issuer: 'BNSP / LSP Lingkungan',
        certificateNumber: 'BNSP-PPCU-2024-8812',
        validUntil: '2027-08-30',
      },
      {
        personnelId: andi.id,
        name: 'Sertifikat K3 Bekerja di Ketinggian & Emisi Isokinetik',
        issuer: 'Kemnaker RI',
        certificateNumber: 'K3-TKPK-2025-4410',
        validUntil: '2028-02-15',
      },
      {
        personnelId: rina.id,
        name: 'Lead Sampling Lingkungan Terpadu',
        issuer: 'LSP Pengujian Laboratorium',
        certificateNumber: 'LSP-ANK-2025-1190',
        validUntil: '2028-05-20',
      },
    ]);
  }

  // Vehicles
  const insertedVehicles = await db
    .insert(vehicles)
    .values([
      {
        vehicleCode: 'VEH-01',
        registrationNumber: 'F 8102 ANK',
        model: 'Toyota Hilux Double Cabin 4x4',
        vehicleType: 'Double Cabin',
        passengerCapacity: 5,
        operationalStatus: 'AVAILABLE',
        baseLocation: 'Bogor',
        notes: 'Dilengkapi rak alat emisi & cooler box sampel',
        isDemo: true,
      },
      {
        vehicleCode: 'VEH-02',
        registrationNumber: 'F 8205 ANK',
        model: 'Mitsubishi Triton 4x4',
        vehicleType: 'Double Cabin',
        passengerCapacity: 5,
        operationalStatus: 'AVAILABLE',
        baseLocation: 'Bogor',
        notes: 'Siap untuk rute luar kota & area pertambangan',
        isDemo: true,
      },
      {
        vehicleCode: 'VEH-03',
        registrationNumber: 'F 1490 ANK',
        model: 'Toyota Innova Zenix',
        vehicleType: 'MPV Operasional',
        passengerCapacity: 6,
        operationalStatus: 'AVAILABLE',
        baseLocation: 'Jakarta',
        notes: 'Sampling Jabodetabek (air limbah & udara ambien)',
        isDemo: true,
      },
      {
        vehicleCode: 'VEH-04',
        registrationNumber: 'F 8812 ANK',
        model: 'Daihatsu GranMax Blind Van',
        vehicleType: 'Van Logistik Alat',
        passengerCapacity: 3,
        operationalStatus: 'MAINTENANCE',
        baseLocation: 'Bogor',
        notes: 'Servis berkala 40.000 km hingga 30 November 2026',
        isDemo: true,
      },
    ])
    .onConflictDoNothing()
    .returning();

  const allVehicles =
    insertedVehicles.length > 0 ? insertedVehicles : await db.select().from(vehicles);
  const v1 = allVehicles.find((v) => v.vehicleCode === 'VEH-01') || allVehicles[0];
  const v3 = allVehicles.find((v) => v.vehicleCode === 'VEH-03') || allVehicles[0];

  // Leave request for Hendra Gunawan (EMP-005) on Nov 27 - Nov 29, 2026
  const hendra = pByCode.get('EMP-005');
  if (hendra) {
    await db.insert(leaveRequests).values({
      personnelId: hendra.id,
      leaveType: 'ANNUAL',
      startDate: new Date('2026-11-27T00:00:00Z'),
      endDate: new Date('2026-11-29T23:59:59Z'),
      status: 'APPROVED',
      reason: 'Cuti Tahunan Keluarga',
      approvedBy: actorUserId || null,
      isDemo: true,
    });
  }

  // Sampling Requests across the lifecycle (Relative to Nov 24-25, 2026)
  const reqValues = [
    {
      requestNumber: 'REQ/AKL/2026/11/001',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[0]?.id || null,
      customerName: 'Hotel Lembah Pakuan Bogor',
      customerAddress: 'Jl. Pajajaran Indah No. 18, Bogor Timur, Jawa Barat',
      customerPhone: '0251-8321400',
      customerPic: 'Bapak Hendra Wijaya',
      picPhone: '0812-8800-1122',
      jobName: 'Pemantauan Air Limbah Domestik Triwulan IV',
      lhpNumber: 'LHP-2026-1101',
      jobDescription: 'Pengambilan contoh uji IPAL Outlet & Inlet Hotel Lembah Pakuan',
      proposedDate: new Date('2026-11-28T08:00:00Z'),
      proposedTime: '08:00',
      estimatedDurationHours: 6,
      mobilizationHours: 1,
      samplingLocation: 'IPAL Hotel Lembah Pakuan, Bogor',
      specialInstructions: 'Membawa botol steril untuk Total Coliform (subkontrak).',
      status: 'SUBMITTED',
      revisionNumber: 1,
      isDemo: true,
    },
    {
      requestNumber: 'REQ/AKL/2026/11/002',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[2]?.id || null,
      customerName: 'PT Nusantara Energi Lestari',
      customerAddress: 'Kawasan Industri Cikarang Barat Blok C-12, Bekasi',
      customerPhone: '021-89904412',
      customerPic: 'Bapak Arif Budiman',
      picPhone: '0856-9123-4500',
      jobName: 'Pengujian Emisi Cerobong Boiler & Genset',
      lhpNumber: 'LHP-2026-1102',
      jobDescription: 'Pengukuran emisi isokinetik 2 cerobong boiler dan 3 genset cadangan.',
      proposedDate: new Date('2026-11-30T07:30:00Z'),
      proposedTime: '07:30',
      estimatedDurationHours: 9,
      mobilizationHours: 2,
      samplingLocation: 'Plant Cikarang Barat, Bekasi',
      specialInstructions: 'Wajib APD lengkap, helm, body harness, dan surat izin kerja ketinggian.',
      status: 'APPROVED',
      revisionNumber: 1,
      isDemo: true,
    },
    {
      requestNumber: 'REQ/AKL/2026/11/003',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[1]?.id || null,
      customerName: 'RS Sentosa Medika Bogor',
      customerAddress: 'Jl. Sholeh Iskandar No. 45, Tanah Sareal, Kota Bogor',
      customerPhone: '0251-8390221',
      customerPic: 'Ibu Ratna Sari',
      picPhone: '0813-7744-5566',
      jobName: 'Pemantauan IPAL & Udara Ambien Rumah Sakit',
      lhpNumber: 'LHP-2026-1103',
      jobDescription: 'Monitoring rutin IPAL Medis dan Udara Ambien area parkir.',
      proposedDate: new Date('2026-11-27T08:00:00Z'),
      proposedTime: '08:00',
      estimatedDurationHours: 8,
      mobilizationHours: 1,
      samplingLocation: 'RS Sentosa Medika, Tanah Sareal, Bogor',
      specialInstructions: 'Koordinasi dengan bagian Kesling RS setiba di lokasi.',
      status: 'SCHEDULED',
      revisionNumber: 1,
      isDemo: true,
    },
    {
      requestNumber: 'REQ/AKL/2026/11/004',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[3]?.id || null,
      customerName: 'PT Tambang Mineral Khatulistiwa',
      customerAddress: 'Site Morowali Utara, Sulawesi Tengah',
      customerPhone: '-',
      customerPic: 'Bapak Dimas Prasetyo',
      picPhone: '0811-4455-8899',
      jobName: 'Pemantauan Lingkungan Terpadu Semester II',
      lhpNumber: 'LHP-2026-1104',
      jobDescription: 'Air permukaan sungai, air limbah tambang, dan biota perairan.',
      proposedDate: new Date('2026-12-03T07:00:00Z'),
      proposedTime: '07:00',
      estimatedDurationHours: 10,
      mobilizationHours: 4,
      samplingLocation: 'Morowali Utara, Sulawesi Tengah',
      specialInstructions: 'Perlu klarifikasi titik koordinat sungai Ake Main sebelum persetujuan.',
      status: 'REVISION_REQUESTED',
      revisionNumber: 1,
      isDemo: true,
    },
    {
      requestNumber: 'REQ/AKL/2026/11/005',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[4]?.id || null,
      customerName: 'PT Agro Sawit Sejahtera',
      customerAddress: 'Jl. Raya Pelabuhan Ketapang Km. 14, Kalimantan Barat',
      customerPhone: '0534-3031900',
      customerPic: 'Ibu Nadia Putri',
      picPhone: '0812-6677-3344',
      jobName: 'Pemantauan Air Limbah Pabrik Kelapa Sawit',
      lhpNumber: 'LHP-2026-1088',
      jobDescription: 'Pengujian kolam anaerobik dan outlet aplikasi lahan.',
      proposedDate: new Date('2026-11-18T08:00:00Z'),
      proposedTime: '08:00',
      estimatedDurationHours: 8,
      mobilizationHours: 2,
      samplingLocation: 'Ketapang, Kalimantan Barat',
      specialInstructions: '-',
      status: 'COMPLETED',
      revisionNumber: 1,
      isDemo: true,
    },
    {
      requestNumber: 'REQ/AKL/2026/11/006',
      createdBy: actorUserId || null,
      createdByName: 'Siti Rahmawati (KAE)',
      customerId: insertedCustomers[0]?.id || null,
      customerName: 'Hotel Lembah Pakuan Bogor',
      customerAddress: 'Jl. Pajajaran Indah No. 18, Bogor Timur, Jawa Barat',
      customerPhone: '0251-8321400',
      customerPic: 'Bapak Hendra Wijaya',
      picPhone: '0812-8800-1122',
      jobName: 'Pengujian Kebisingan & Kualitas Udara Ruang Genset',
      lhpNumber: '',
      jobDescription: 'Draft permintaan pengujian kebisingan area genset & lobi.',
      proposedDate: new Date('2026-12-08T09:00:00Z'),
      proposedTime: '09:00',
      estimatedDurationHours: 5,
      mobilizationHours: 1,
      samplingLocation: 'Bogor Timur, Jawa Barat',
      specialInstructions: 'Menunggu konfirmasi jadwal dari manajemen hotel.',
      status: 'DRAFT',
      revisionNumber: 1,
      isDemo: true,
    },
  ];

  const insertedReqs = await db.insert(samplingRequests).values(reqValues).returning();

  // Attach dynamic matrices & parameters to each sampling request
  const matrixRecordsToInsert: Array<{
    reqIdx: number;
    matrixName: string;
    pointCount: number;
    pointDescription: string;
    regulationName: string;
    params: Array<{ name: string; unit: string; isSub: boolean }>;
  }> = [
    {
      reqIdx: 0,
      matrixName: 'Air Limbah Domestik',
      pointCount: 2,
      pointDescription: 'Inlet IPAL & Outlet IPAL Hotel',
      regulationName: 'PermenLHK No. P.68 Tahun 2016',
      params: [
        { name: 'pH', unit: '-', isSub: false },
        { name: 'BOD5', unit: 'mg/L', isSub: false },
        { name: 'COD', unit: 'mg/L', isSub: false },
        { name: 'TSS', unit: 'mg/L', isSub: false },
        { name: 'Minyak & Lemak', unit: 'mg/L', isSub: false },
        { name: 'Amoniak (NH3-N)', unit: 'mg/L', isSub: false },
        { name: 'Total Coliform', unit: 'MPN/100mL', isSub: true },
      ],
    },
    {
      reqIdx: 1,
      matrixName: 'Emisi Sumber Tidak Bergerak',
      pointCount: 5,
      pointDescription: '2 Cerobong Boiler + 3 Cerobong Genset',
      regulationName: 'PermenLHK No. 11 Tahun 2021',
      params: [
        { name: 'Total Partikulat (Isokinetik)', unit: 'mg/Nm³', isSub: false },
        { name: 'Sulfur Dioksida (SO2)', unit: 'mg/Nm³', isSub: false },
        { name: 'Nitrogen Dioksida (NO2)', unit: 'mg/Nm³', isSub: false },
        { name: 'Karbon Monoksida (CO)', unit: 'mg/Nm³', isSub: false },
      ],
    },
    {
      reqIdx: 2,
      matrixName: 'Air Limbah (Wastewater)',
      pointCount: 1,
      pointDescription: 'Outlet IPAL RS Sentosa Medika',
      regulationName: 'PermenLHK No. 11 Tahun 2025 Lamp. I A.2',
      params: [
        { name: 'pH', unit: '-', isSub: false },
        { name: 'BOD5', unit: 'mg/L', isSub: false },
        { name: 'COD', unit: 'mg/L', isSub: false },
        { name: 'TSS', unit: 'mg/L', isSub: false },
        { name: 'Klorin Bebas (Cl2)', unit: 'mg/L', isSub: false },
        { name: 'Total Coliform', unit: 'MPN/100mL', isSub: true },
      ],
    },
    {
      reqIdx: 2,
      matrixName: 'Udara Ambien & Kebisingan',
      pointCount: 2,
      pointDescription: 'Area Parkir Depan & Belakang IGD',
      regulationName: 'PP No. 22 Tahun 2021 Lampiran VII',
      params: [
        { name: 'Sulfur Dioksida (SO2)', unit: 'µg/Nm³', isSub: false },
        { name: 'Nitrogen Dioksida (NO2)', unit: 'µg/Nm³', isSub: false },
        { name: 'Partikulat PM10', unit: 'µg/Nm³', isSub: false },
        { name: 'Kebisingan 24 Jam', unit: 'dBA', isSub: false },
      ],
    },
    {
      reqIdx: 3,
      matrixName: 'Air Permukaan (Surface Water)',
      pointCount: 3,
      pointDescription: 'Sungai Upstream, Midstream, Downstream',
      regulationName: 'PP No. 22 Tahun 2021 Lampiran VI',
      params: [
        { name: 'pH', unit: '-', isSub: false },
        { name: 'Oksigen Terlarut (DO)', unit: 'mg/L', isSub: false },
        { name: 'TSS', unit: 'mg/L', isSub: false },
        { name: 'Timbal (Pb)', unit: 'mg/L', isSub: false },
        { name: 'Besi (Fe)', unit: 'mg/L', isSub: false },
      ],
    },
    {
      reqIdx: 4,
      matrixName: 'Air Limbah (Wastewater)',
      pointCount: 2,
      pointDescription: 'Kolam Anaerobik & Outlet',
      regulationName: 'PermenLH No. 5 Tahun 2014',
      params: [
        { name: 'pH', unit: '-', isSub: false },
        { name: 'BOD5', unit: 'mg/L', isSub: false },
        { name: 'COD', unit: 'mg/L', isSub: false },
        { name: 'TSS', unit: 'mg/L', isSub: false },
      ],
    },
    {
      reqIdx: 5,
      matrixName: 'Udara Ambien & Kebisingan',
      pointCount: 2,
      pointDescription: 'Ruang Genset & Halaman Depan',
      regulationName: 'KepmenLH No. 48 Tahun 1996',
      params: [{ name: 'Kebisingan 24 Jam', unit: 'dBA', isSub: false }],
    },
  ];

  for (const mSpec of matrixRecordsToInsert) {
    const req = insertedReqs[mSpec.reqIdx];
    if (!req) continue;
    const [insertedM] = await db
      .insert(requestMatrices)
      .values({
        requestId: req.id,
        matrixName: mSpec.matrixName,
        pointCount: mSpec.pointCount,
        pointDescription: mSpec.pointDescription,
        regulationName: mSpec.regulationName,
        sortOrder: 0,
      })
      .returning();

    await db.insert(requestMatrixParameters).values(
      mSpec.params.map((p) => ({
        requestMatrixId: insertedM.id,
        parameterName: p.name,
        unit: p.unit,
        isSubcontracted: p.isSub,
      }))
    );
  }

  // Approvals history
  await db.insert(requestApprovals).values([
    {
      requestId: insertedReqs[1].id,
      approverId: actorUserId || null,
      approverName: 'Yogi Driantama (SPV Sampling)',
      decision: 'APPROVED',
      comments: 'Disetujui. Segera tugaskan tim emisi isokinetik & kendaraan F 8102 ANK.',
      revisionNumber: 1,
    },
    {
      requestId: insertedReqs[2].id,
      approverId: actorUserId || null,
      approverName: 'Yogi Driantama (SPV Sampling)',
      decision: 'APPROVED',
      comments: 'Disetujui dan dijadwalkan untuk 27 November 2026.',
      revisionNumber: 1,
    },
    {
      requestId: insertedReqs[3].id,
      approverId: actorUserId || null,
      approverName: 'Yogi Driantama (SPV Sampling)',
      decision: 'REVISION_REQUESTED',
      comments: 'Mohon lengkapi titik koordinat lokasi sungai dan konfirmasi durasi mobilisasi kapal.',
      revisionNumber: 1,
    },
  ]);

  // Schedules for Scheduled (idx 2), Completed (idx 4), and Postponed demo (idx 1)
  const [schScheduled] = await db
    .insert(samplingSchedules)
    .values({
      requestId: insertedReqs[2].id,
      scheduleCode: 'SCH-2026-1103',
      activityName: 'Pemantauan IPAL & Udara Ambien RS Sentosa Medika',
      startDate: new Date('2026-11-27T08:00:00Z'),
      endDate: new Date('2026-11-27T16:00:00Z'),
      mobilizationBufferHours: 2,
      returnBufferHours: 2,
      revisionNumber: 1,
      isActive: true,
      notes: 'Jadwal aktif terkonfirmasi',
      isDemo: true,
    })
    .returning();

  const [schCompleted] = await db
    .insert(samplingSchedules)
    .values({
      requestId: insertedReqs[4].id,
      scheduleCode: 'SCH-2026-1088',
      activityName: 'Pemantauan Air Limbah PT Agro Sawit Sejahtera',
      startDate: new Date('2026-11-18T08:00:00Z'),
      endDate: new Date('2026-11-18T16:00:00Z'),
      mobilizationBufferHours: 2,
      returnBufferHours: 2,
      revisionNumber: 1,
      isActive: true,
      notes: 'Pelaksanaan lapangan selesai',
      isDemo: true,
    })
    .returning();

  const [schPostponed] = await db
    .insert(samplingSchedules)
    .values({
      requestId: insertedReqs[1].id,
      scheduleCode: 'SCH-2026-1102-REV2',
      activityName: 'Pengujian Emisi Boiler & Genset (Jadwal Penundaan Terkonfirmasi)',
      startDate: new Date('2026-12-05T07:30:00Z'),
      endDate: new Date('2026-12-05T16:30:00Z'),
      mobilizationBufferHours: 2,
      returnBufferHours: 2,
      revisionNumber: 2,
      isActive: true,
      postponeReason: 'Penundaan dari pelanggan karena overhaul boiler hingga awal Desember',
      notes: 'Jadwal aktif terbaru setelah revisi penundaan',
      isDemo: true,
    })
    .returning();

  // Assignments (Confirms Budi Santoso & Dedi Pratama on Nov 27 -> creates real conflict demo on Nov 27!)
  const dedi = pByCode.get('EMP-003');
  const frl1 = pByCode.get('FRL-001');
  if (budi && dedi && rina) {
    await db.insert(personnelAssignments).values([
      {
        scheduleId: schScheduled.id,
        requestId: insertedReqs[2].id,
        personnelId: budi.id,
        roleInTeam: 'TEAM_LEADER',
        assignmentStatus: 'CONFIRMED',
        assignmentMode: 'MANUAL',
        startDate: new Date('2026-11-27T08:00:00Z'),
        endDate: new Date('2026-11-27T16:00:00Z'),
        notes: 'Team Leader IPAL RS Sentosa Medika',
        assignedBy: actorUserId || null,
        isDemo: true,
      },
      {
        scheduleId: schScheduled.id,
        requestId: insertedReqs[2].id,
        personnelId: dedi.id,
        roleInTeam: 'DRIVER',
        assignmentStatus: 'CONFIRMED',
        assignmentMode: 'MANUAL',
        startDate: new Date('2026-11-27T08:00:00Z'),
        endDate: new Date('2026-11-27T16:00:00Z'),
        notes: 'Petugas & Driver Armada F 8102 ANK',
        assignedBy: actorUserId || null,
        isDemo: true,
      },
      {
        scheduleId: schCompleted.id,
        requestId: insertedReqs[4].id,
        personnelId: rina.id,
        roleInTeam: 'TEAM_LEADER',
        assignmentStatus: 'CONFIRMED',
        assignmentMode: 'AUTO_RECOMMENDED',
        startDate: new Date('2026-11-18T08:00:00Z'),
        endDate: new Date('2026-11-18T16:00:00Z'),
        notes: 'Selesai dilaksanakan',
        assignedBy: actorUserId || null,
        isDemo: true,
      },
      ...(frl1
        ? [
            {
              scheduleId: schPostponed.id,
              requestId: insertedReqs[1].id,
              personnelId: frl1.id,
              roleInTeam: 'MEMBER',
              assignmentStatus: 'TENTATIVE',
              assignmentMode: 'AUTO_RECOMMENDED',
              startDate: new Date('2026-12-05T07:30:00Z'),
              endDate: new Date('2026-12-05T16:30:00Z'),
              notes: 'Penugasan tentatif menunggu finalisasi SPV',
              assignedBy: actorUserId || null,
              isDemo: true,
            },
          ]
        : []),
    ]);
  }

  // Vehicle reservation on Nov 27 for VEH-01
  if (v1 && dedi) {
    await db.insert(vehicleReservations).values([
      {
        vehicleId: v1.id,
        scheduleId: schScheduled.id,
        requestId: insertedReqs[2].id,
        driverPersonnelId: dedi.id,
        departureTime: new Date('2026-11-27T06:30:00Z'),
        returnTime: new Date('2026-11-27T17:30:00Z'),
        destination: 'RS Sentosa Medika Bogor',
        passengerCount: 2,
        status: 'RESERVED',
        notes: 'Membawa peralatan sampling air limbah & udara ambien',
        reservedBy: actorUserId || null,
        isDemo: true,
      },
      ...(v3 && rina
        ? [
            {
              vehicleId: v3.id,
              scheduleId: schPostponed.id,
              requestId: insertedReqs[1].id,
              driverPersonnelId: rina.id,
              departureTime: new Date('2026-12-05T06:00:00Z'),
              returnTime: new Date('2026-12-05T18:00:00Z'),
              destination: 'Cikarang Barat, Bekasi',
              passengerCount: 3,
              status: 'RESERVED',
              notes: 'Kendaraan pendukung tim emisi',
              reservedBy: actorUserId || null,
              isDemo: true,
            },
          ]
        : []),
    ]);
  }

  // SPS Documents:
  // 1) Upcoming Active SPS
  // 2) Past-schedule Active SPS -> triggers Archival Confirmation
  // 3) Postponed SPS -> original date passed, latest schedule Dec 5 -> must remain ACTIVE
  // 4) Archived Historical SPS
  const spsSeed = await db
    .insert(spsDocuments)
    .values([
      {
        spsNumber: '029/SPS/AKL/XI/2026',
        requestId: insertedReqs[2].id,
        scheduleId: schScheduled.id,
        customerName: 'RS Sentosa Medika Bogor',
        customerAddress: 'Jl. Sholeh Iskandar No. 45, Tanah Sareal, Kota Bogor',
        customerPhone: '0251-8390221',
        customerPic: 'Ibu Ratna Sari',
        picPhone: '0813-7744-5566',
        jobName: 'Pemantauan IPAL & Udara Ambien Rumah Sakit',
        lhpNumber: 'LHP-2026-1103',
        samplingDateLabel: '27 November 2026',
        samplingStartDate: new Date('2026-11-27T08:00:00Z'),
        samplingEndDate: new Date('2026-11-27T16:00:00Z'),
        samplingLocation: 'RS Sentosa Medika, Tanah Sareal, Bogor',
        assignedPersonnelNames: ['Budi Santoso', 'Dedi Pratama'],
        scheduleRows: [
          {
            dateLabel: '27 November 2026',
            activity: 'Pemantauan IPAL & Udara Ambien Rumah Sakit',
            notes: 'Armada F 8102 ANK',
          },
        ],
        matrixRows: [
          {
            no: 1,
            dateLabel: '27 November 2026',
            matrixName: 'Air Limbah (Wastewater)',
            pointCount: 1,
            pointLocations: 'Outlet IPAL RS Sentosa Medika',
            parameters: 'pH, BOD5, COD, TSS, Klorin Bebas (Cl2)',
            subcontractedParameters: 'Total Coliform',
            regulation: 'PermenLHK No. 11 Tahun 2025 Lamp. I A.2',
          },
          {
            no: 2,
            dateLabel: '27 November 2026',
            matrixName: 'Udara Ambien & Kebisingan',
            pointCount: 2,
            pointLocations: 'Area Parkir Depan & Belakang IGD',
            parameters: 'SO2, NO2, PM10, Kebisingan 24 Jam',
            subcontractedParameters: '',
            regulation: 'PP No. 22 Tahun 2021 Lampiran VII',
          },
        ],
        notes: 'Koordinasi dengan bagian Kesling RS setiba di lokasi.',
        preparedByName: 'Yogi Driantama',
        lifecycleStatus: 'ACTIVE',
        createdBy: actorUserId || null,
        isDemo: true,
      },
      {
        spsNumber: '025/SPS/AKL/XI/2026',
        requestId: insertedReqs[4].id,
        scheduleId: schCompleted.id,
        customerName: 'PT Agro Sawit Sejahtera',
        customerAddress: 'Jl. Raya Pelabuhan Ketapang Km. 14, Kalimantan Barat',
        customerPhone: '0534-3031900',
        customerPic: 'Ibu Nadia Putri',
        picPhone: '0812-6677-3344',
        jobName: 'Pemantauan Air Limbah Pabrik Kelapa Sawit',
        lhpNumber: 'LHP-2026-1088',
        samplingDateLabel: '18 November 2026',
        samplingStartDate: new Date('2026-11-18T08:00:00Z'),
        samplingEndDate: new Date('2026-11-18T16:00:00Z'),
        samplingLocation: 'Ketapang, Kalimantan Barat',
        assignedPersonnelNames: ['Rina Kusuma'],
        scheduleRows: [
          {
            dateLabel: '18 November 2026',
            activity: 'Pemantauan Air Limbah Pabrik Kelapa Sawit',
            notes: 'Selesai dilaksanakan',
          },
        ],
        matrixRows: [
          {
            no: 1,
            dateLabel: '18 November 2026',
            matrixName: 'Air Limbah (Wastewater)',
            pointCount: 2,
            pointLocations: 'Kolam Anaerobik & Outlet',
            parameters: 'pH, BOD5, COD, TSS',
            subcontractedParameters: '',
            regulation: 'PermenLH No. 5 Tahun 2014',
          },
        ],
        notes: 'Menunggu konfirmasi pengarsipan oleh SPV Sampling.',
        preparedByName: 'Yogi Driantama',
        lifecycleStatus: 'PENDING_ARCHIVAL',
        createdBy: actorUserId || null,
        isDemo: true,
      },
      {
        spsNumber: '026/SPS/AKL/XI/2026',
        requestId: insertedReqs[1].id,
        scheduleId: schPostponed.id,
        customerName: 'PT Nusantara Energi Lestari',
        customerAddress: 'Kawasan Industri Cikarang Barat Blok C-12, Bekasi',
        customerPhone: '021-89904412',
        customerPic: 'Bapak Arif Budiman',
        picPhone: '0856-9123-4500',
        jobName: 'Pengujian Emisi Cerobong Boiler & Genset (Ditunda)',
        lhpNumber: 'LHP-2026-1102',
        samplingDateLabel: '05 Desember 2026 (Revisi dari 20 Nov 2026)',
        samplingStartDate: new Date('2026-11-20T07:30:00Z'), // original date passed
        samplingEndDate: new Date('2026-11-20T16:30:00Z'),
        samplingLocation: 'Plant Cikarang Barat, Bekasi',
        assignedPersonnelNames: ['Rizky Ramadhan'],
        scheduleRows: [
          {
            dateLabel: '05 Desember 2026',
            activity: 'Pengujian Emisi Boiler & Genset (Jadwal Revisi)',
            notes: 'Penundaan disetujui karena overhaul boiler',
          },
        ],
        matrixRows: [
          {
            no: 1,
            dateLabel: '05 Desember 2026',
            matrixName: 'Emisi Sumber Tidak Bergerak',
            pointCount: 5,
            pointLocations: '2 Cerobong Boiler + 3 Cerobong Genset',
            parameters: 'Total Partikulat, SO2, NO2, CO',
            subcontractedParameters: '',
            regulation: 'PermenLHK No. 11 Tahun 2021',
          },
        ],
        notes: 'Jadwal diperbarui ke 5 Desember 2026.',
        preparedByName: 'Yogi Driantama',
        revisionNumber: 2,
        lifecycleStatus: 'ACTIVE',
        createdBy: actorUserId || null,
        isDemo: true,
      },
      {
        spsNumber: '018/SPS/AKL/X/2026',
        customerName: 'Hotel Lembah Pakuan Bogor',
        customerAddress: 'Jl. Pajajaran Indah No. 18, Bogor Timur, Jawa Barat',
        customerPhone: '0251-8321400',
        customerPic: 'Bapak Hendra Wijaya',
        picPhone: '0812-8800-1122',
        jobName: 'Pemantauan Lingkungan Triwulan III',
        lhpNumber: 'LHP-2026-0980',
        samplingDateLabel: '14 Oktober 2026',
        samplingStartDate: new Date('2026-10-14T08:00:00Z'),
        samplingEndDate: new Date('2026-10-14T16:00:00Z'),
        samplingLocation: 'Bogor Timur, Jawa Barat',
        assignedPersonnelNames: ['Budi Santoso', 'Rina Kusuma'],
        scheduleRows: [
          {
            dateLabel: '14 Oktober 2026',
            activity: 'Pemantauan Lingkungan',
            notes: '-',
          },
        ],
        matrixRows: [
          {
            no: 1,
            dateLabel: '14 Oktober 2026',
            matrixName: 'Air Limbah Domestik',
            pointCount: 1,
            pointLocations: 'Outlet IPAL Hotel',
            parameters: 'pH, BOD5, COD, TSS, Minyak & Lemak, Amoniak',
            subcontractedParameters: 'Total Coliform',
            regulation: 'PermenLHK No. P.68 Tahun 2016',
          },
        ],
        notes: 'Arsip historis Triwulan III.',
        preparedByName: 'Yogi Driantama',
        lifecycleStatus: 'ARCHIVED',
        archivedAt: new Date('2026-10-18T10:00:00Z'),
        archivedBy: actorUserId || null,
        isHistoricalImport: true,
        createdBy: actorUserId || null,
        isDemo: true,
      },
    ])
    .returning();

  // Archive entry & events for 018/SPS/AKL/X/2026
  const archivedDoc = spsSeed.find((d) => d.spsNumber === '018/SPS/AKL/X/2026');
  if (archivedDoc) {
    await db.insert(documentArchives).values({
      spsDocumentId: archivedDoc.id,
      spsNumber: archivedDoc.spsNumber,
      customerName: archivedDoc.customerName,
      jobName: archivedDoc.jobName,
      samplingYear: 2026,
      matricesSummary: 'Air Limbah Domestik',
      personnelSummary: 'Budi Santoso, Rina Kusuma',
      archivedBy: actorUserId || null,
      archivedByName: 'SPV Sampling ANKAL',
      archivedAt: new Date('2026-10-18T10:00:00Z'),
      archivalReason: 'Jadwal pengambilan contoh uji selesai & LHP terbit',
      isActiveArchive: true,
    });

    await db.insert(spsRevisions).values({
      spsDocumentId: archivedDoc.id,
      revisionNumber: 1,
      snapshotData: archivedDoc,
      changeReason: 'Penerbitan SPS Awal',
      revisedBy: actorUserId || null,
      revisedByName: 'Yogi Driantama',
    });

    await db.insert(documentEvents).values({
      spsDocumentId: archivedDoc.id,
      eventType: 'ARCHIVED',
      actorId: actorUserId || null,
      actorName: 'SPV Sampling ANKAL',
      details: { reason: 'Arsip historis Triwulan III' },
    });
  }

  // SPS Templates from historical SPS
  await db.insert(spsTemplates).values([
    {
      templateName: 'Template IPAL Hotel Standar (PermenLHK 68/2016)',
      sourceSpsId: archivedDoc?.id || null,
      originalSpsNumber: '018/SPS/AKL/X/2026',
      customerName: 'Hotel Lembah Pakuan Bogor',
      customerAddress: 'Jl. Pajajaran Indah No. 18, Bogor Timur, Jawa Barat',
      customerPic: 'Bapak Hendra Wijaya',
      picPhone: '0812-8800-1122',
      jobName: 'Pemantauan Lingkungan',
      samplingLocation: 'Bogor Timur, Jawa Barat',
      activityDescription: 'Pemantauan Air Limbah Domestik IPAL Hotel',
      defaultNotes: 'Membawa botol steril untuk Total Coliform (subkontrak).',
      matrixConfig: [
        {
          no: 1,
          dateLabel: 'Sesuai jadwal baru',
          matrixName: 'Air Limbah Domestik',
          pointCount: 1,
          pointLocations: 'Outlet IPAL Hotel',
          parameters: 'pH, BOD5, COD, TSS, Minyak & Lemak, Amoniak',
          subcontractedParameters: 'Total Coliform',
          regulation: 'PermenLHK No. P.68 Tahun 2016',
        },
      ],
      documentLayoutRef: 'ANKAL-FO-7.1-01',
      version: 1,
      createdBy: actorUserId || null,
      isDemo: true,
    },
    {
      templateName: 'Template Pemantauan RS (Air Limbah & Ambien)',
      sourceSpsId: spsSeed[0]?.id || null,
      originalSpsNumber: '029/SPS/AKL/XI/2026',
      customerName: 'RS Sentosa Medika Bogor',
      customerAddress: 'Jl. Sholeh Iskandar No. 45, Tanah Sareal, Kota Bogor',
      customerPic: 'Ibu Ratna Sari',
      picPhone: '0813-7744-5566',
      jobName: 'Pemantauan IPAL & Udara Ambien Rumah Sakit',
      samplingLocation: 'RS Sentosa Medika, Bogor',
      activityDescription: 'Pemantauan Lingkungan Fasilitas Kesehatan',
      defaultNotes: 'Koordinasi dengan bagian Kesling RS.',
      matrixConfig: spsSeed[0]?.matrixRows || [],
      documentLayoutRef: 'ANKAL-FO-7.1-01',
      version: 1,
      createdBy: actorUserId || null,
      isDemo: true,
    },
  ]);

  // Notifications including Archival Confirmation Required for 025/SPS/AKL/XI/2026
  await db.insert(notifications).values([
    {
      recipientRole: 'SPV_SAMPLING',
      eventType: 'REQUEST_SUBMITTED',
      title: 'Permintaan Sampling Baru Diajukan',
      recordNumber: 'REQ/AKL/2026/11/001',
      description: 'Hotel Lembah Pakuan Bogor — Pemantauan Air Limbah Domestik Triwulan IV menunggu review SPV.',
      targetRoute: 'requests',
      targetId: insertedReqs[0].id,
      isRead: false,
      actionRequired: true,
      isDemo: true,
    },
    {
      recipientRole: 'SPV_SAMPLING',
      eventType: 'ARCHIVAL_CONFIRMATION_REQUIRED',
      title: 'Konfirmasi Pengarsipan Dokumen SPS',
      recordNumber: '025/SPS/AKL/XI/2026',
      description:
        'Jadwal pengambilan contoh uji untuk SPS 025/SPS/AKL/XI/2026 telah melewati tanggal pelaksanaan. Apakah dokumen ini ingin dipindahkan ke arsip?',
      targetRoute: 'sps',
      targetId: spsSeed[1].id,
      isRead: false,
      actionRequired: true,
      actionPayload: { spsDocumentId: spsSeed[1].id, spsNumber: '025/SPS/AKL/XI/2026' },
      isDemo: true,
    },
    {
      recipientRole: 'KAE_SALES',
      eventType: 'REVISION_REQUESTED',
      title: 'Permintaan Revisi dari SPV Sampling',
      recordNumber: 'REQ/AKL/2026/11/004',
      description: 'PT Tambang Mineral Khatulistiwa memerlukan klarifikasi titik koordinat sungai sebelum disetujui.',
      targetRoute: 'requests',
      targetId: insertedReqs[3].id,
      isRead: false,
      actionRequired: true,
      isDemo: true,
    },
  ]);

  await db.insert(auditLogs).values({
    actorUserId: actorUserId || null,
    actorName: 'Sistem ANKAL',
    actorRole: 'MANAGEMENT',
    action: forceResetDemo ? 'RESET_DEMO_DATA' : 'SEED_DEMO_DATA',
    entityType: 'SYSTEM',
    entityId: 'demo-seed',
    entityNumber: 'DEMO-INIT',
    notes: 'Inisialisasi data demonstrasi operasional lapangan ANKAL',
  });

  return { seeded: true, message: 'Data demonstrasi berhasil diinisialisasi.' };
}
