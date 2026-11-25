import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. IDENTITY & ACCESS
// ============================================================================

export const departments = pgTable('departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('KAE_SALES'), // 'KAE_SALES' | 'SPV_SAMPLING' | 'MANAGEMENT'
  approvalStatus: text('approval_status').notNull().default('PENDING'), // 'PENDING' | 'APPROVED' | 'REJECTED'
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at'),
  departmentId: uuid('department_id').references(() => departments.id),
  isActive: boolean('is_active').default(true).notNull(),
  avatarUrl: text('avatar_url').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// 2. PERSONNEL & AVAILABILITY
// ============================================================================

export const personnel = pgTable('personnel', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  userId: uuid('user_id').references(() => users.id),
  category: text('category').notNull().default('INTERNAL'), // 'INTERNAL' | 'EXTERNAL'
  fullName: text('full_name').notNull(),
  departmentId: uuid('department_id').references(() => departments.id),
  position: text('position').notNull().default('Sampling Officer'),
  phone: text('phone').notNull().default(''),
  email: text('email').default(''),
  baseLocation: text('base_location').notNull().default('Bogor'),
  employmentStatus: text('employment_status').notNull().default('ACTIVE'), // 'ACTIVE' | 'INACTIVE' | 'TERMINATED'
  fieldEligible: boolean('field_eligible').default(true).notNull(),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  notes: text('notes').default(''),
  supportingDocs: jsonb('supporting_docs').$type<Array<{ name: string; url?: string }>>().default([]).notNull(),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const competencies = pgTable('competencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  matrixCategory: text('matrix_category').notNull(),
  description: text('description').default(''),
});

export const personnelCompetencies = pgTable('personnel_competencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  personnelId: uuid('personnel_id')
    .references(() => personnel.id, { onDelete: 'cascade' })
    .notNull(),
  competencyId: uuid('competency_id')
    .references(() => competencies.id, { onDelete: 'cascade' })
    .notNull(),
  verified: boolean('verified').default(true).notNull(),
  level: text('level').notNull().default('SENIOR'), // 'JUNIOR' | 'SENIOR' | 'LEAD'
});

export const certifications = pgTable('certifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  personnelId: uuid('personnel_id')
    .references(() => personnel.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  issuer: text('issuer').notNull().default(''),
  certificateNumber: text('certificate_number').notNull().default(''),
  validUntil: text('valid_until').notNull().default(''),
});

export const availabilityRecords = pgTable('availability_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  personnelId: uuid('personnel_id')
    .references(() => personnel.id, { onDelete: 'cascade' })
    .notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  status: text('status').notNull(), // 'AVAILABLE' | 'TENTATIVE' | 'ASSIGNED' | 'UNAVAILABLE' | 'ON_LEAVE'
  source: text('source').notNull().default('MANUAL'), // 'MANUAL' | 'SYSTEM' | 'LEAVE'
  reason: text('reason').default(''),
  confirmedBy: uuid('confirmed_by').references(() => users.id),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  personnelId: uuid('personnel_id')
    .references(() => personnel.id, { onDelete: 'cascade' })
    .notNull(),
  leaveType: text('leave_type').notNull().default('ANNUAL'), // 'ANNUAL' | 'SICK' | 'TRAINING' | 'OTHER'
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  status: text('status').notNull().default('APPROVED'), // 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: text('reason').default(''),
  approvedBy: uuid('approved_by').references(() => users.id),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// 3. MASTER DATA & CUSTOMERS
// ============================================================================

export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull().default(''),
  phone: text('phone').default(''),
  picName: text('pic_name').notNull().default(''),
  picPhone: text('pic_phone').notNull().default(''),
  email: text('email').default(''),
  industry: text('industry').default(''),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const matrices = pgTable('matrices', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  requiredCompetencyId: uuid('required_competency_id').references(() => competencies.id),
  description: text('description').default(''),
});

export const parameters = pgTable('parameters', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('-'),
  matrixCategory: text('matrix_category').notNull(),
  isSubcontractDefault: boolean('is_subcontract_default').default(false).notNull(),
  method: text('method').default(''),
});

export const regulations = pgTable('regulations', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  matrixCategory: text('matrix_category').notNull(),
  year: integer('year').default(2021),
  description: text('description').default(''),
});

// ============================================================================
// 4. SAMPLING REQUESTS, SCHEDULES & APPROVALS
// ============================================================================

export const samplingRequests = pgTable('sampling_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestNumber: text('request_number').notNull().unique(),
  createdBy: uuid('created_by').references(() => users.id),
  createdByName: text('created_by_name').notNull().default(''),
  customerId: uuid('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull(),
  customerAddress: text('customer_address').notNull().default(''),
  customerPhone: text('customer_phone').default(''),
  customerPic: text('customer_pic').notNull().default(''),
  picPhone: text('pic_phone').notNull().default(''),
  jobName: text('job_name').notNull(),
  lhpNumber: text('lhp_number').default(''),
  contractNumber: text('contract_number').default(''),
  jobDescription: text('job_description').default(''),
  proposedDate: timestamp('proposed_date').notNull(),
  proposedEndDate: timestamp('proposed_end_date'),
  proposedTime: text('proposed_time').notNull().default('08:00'),
  estimatedDurationHours: integer('estimated_duration_hours').notNull().default(8),
  mobilizationHours: integer('mobilization_hours').notNull().default(2),
  samplingLocation: text('sampling_location').notNull(),
  specialInstructions: text('special_instructions').default(''),
  attachments: jsonb('attachments').$type<Array<{ name: string; size?: number; type?: string }>>().default([]).notNull(),
  status: text('status').notNull().default('DRAFT'),
  // 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'REVISION_REQUESTED' | 'APPROVED' | 'REJECTED' | 'ASSIGNED' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED' | 'CANCELLED'
  sourceTemplateId: uuid('source_template_id'),
  revisionNumber: integer('revision_number').default(1).notNull(),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const requestMatrices = pgTable('request_matrices', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id')
    .references(() => samplingRequests.id, { onDelete: 'cascade' })
    .notNull(),
  matrixId: uuid('matrix_id').references(() => matrices.id),
  matrixName: text('matrix_name').notNull(),
  pointCount: integer('point_count').notNull().default(1),
  pointDescription: text('point_description').notNull().default('Sesuai ketentuan pelanggan'),
  regulationId: uuid('regulation_id').references(() => regulations.id),
  regulationName: text('regulation_name').notNull().default('-'),
  notes: text('notes').default(''),
  sortOrder: integer('sort_order').default(0).notNull(),
});

export const requestMatrixParameters = pgTable('request_matrix_parameters', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestMatrixId: uuid('request_matrix_id')
    .references(() => requestMatrices.id, { onDelete: 'cascade' })
    .notNull(),
  parameterId: uuid('parameter_id').references(() => parameters.id),
  parameterName: text('parameter_name').notNull(),
  unit: text('unit').default('-'),
  isSubcontracted: boolean('is_subcontracted').default(false).notNull(),
});

export const samplingSchedules = pgTable('sampling_schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id')
    .references(() => samplingRequests.id, { onDelete: 'cascade' })
    .notNull(),
  scheduleCode: text('schedule_code').notNull(),
  activityName: text('activity_name').notNull().default('Pemantauan Lingkungan'),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  mobilizationBufferHours: integer('mobilization_buffer_hours').default(2).notNull(),
  returnBufferHours: integer('return_buffer_hours').default(2).notNull(),
  revisionNumber: integer('revision_number').default(1).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  postponeReason: text('postpone_reason').default(''),
  notes: text('notes').default(''),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const requestApprovals = pgTable('request_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  requestId: uuid('request_id')
    .references(() => samplingRequests.id, { onDelete: 'cascade' })
    .notNull(),
  approverId: uuid('approver_id').references(() => users.id),
  approverName: text('approver_name').notNull(),
  decision: text('decision').notNull(),
  comments: text('comments').default(''),
  revisionNumber: integer('revision_number').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// 5. PERSONNEL ASSIGNMENTS & VEHICLES
// ============================================================================

export const personnelAssignments = pgTable('personnel_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  scheduleId: uuid('schedule_id')
    .references(() => samplingSchedules.id, { onDelete: 'cascade' })
    .notNull(),
  requestId: uuid('request_id')
    .references(() => samplingRequests.id, { onDelete: 'cascade' })
    .notNull(),
  personnelId: uuid('personnel_id')
    .references(() => personnel.id)
    .notNull(),
  roleInTeam: text('role_in_team').notNull().default('MEMBER'), // 'TEAM_LEADER' | 'MEMBER' | 'DRIVER'
  assignmentStatus: text('assignment_status').notNull().default('CONFIRMED'), // 'TENTATIVE' | 'CONFIRMED' | 'REPLACED' | 'CANCELLED'
  assignmentMode: text('assignment_mode').notNull().default('MANUAL'), // 'MANUAL' | 'AUTO_RECOMMENDED'
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  notes: text('notes').default(''),
  assignedBy: uuid('assigned_by').references(() => users.id),
  replacedByPersonnelId: uuid('replaced_by_personnel_id'),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const vehicles = pgTable('vehicles', {
  id: uuid('id').defaultRandom().primaryKey(),
  vehicleCode: text('vehicle_code').notNull().unique(),
  registrationNumber: text('registration_number').notNull().unique(),
  model: text('model').notNull(),
  vehicleType: text('vehicle_type').notNull().default('SUV / Double Cabin'),
  passengerCapacity: integer('passenger_capacity').notNull().default(5),
  operationalStatus: text('operational_status').notNull().default('AVAILABLE'), // 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'UNAVAILABLE'
  baseLocation: text('base_location').notNull().default('Bogor'),
  notes: text('notes').default(''),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const vehicleReservations = pgTable('vehicle_reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  vehicleId: uuid('vehicle_id')
    .references(() => vehicles.id)
    .notNull(),
  scheduleId: uuid('schedule_id')
    .references(() => samplingSchedules.id, { onDelete: 'cascade' })
    .notNull(),
  requestId: uuid('request_id')
    .references(() => samplingRequests.id, { onDelete: 'cascade' })
    .notNull(),
  driverPersonnelId: uuid('driver_personnel_id').references(() => personnel.id),
  departureTime: timestamp('departure_time').notNull(),
  returnTime: timestamp('return_time').notNull(),
  destination: text('destination').notNull(),
  passengerCount: integer('passenger_count').notNull().default(2),
  status: text('status').notNull().default('RESERVED'), // 'RESERVED' | 'IN_USE' | 'COMPLETED' | 'CANCELLED'
  notes: text('notes').default(''),
  reservedBy: uuid('reserved_by').references(() => users.id),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// 6. SPS DOCUMENTS, TEMPLATES, ARCHIVES & IMPORT CENTER
// ============================================================================

export type SpsScheduleRow = {
  dateLabel: string;
  activity: string;
  notes: string;
};

export type SpsMatrixRow = {
  no: number;
  dateLabel: string;
  matrixName: string;
  pointCount: number;
  pointLocations: string;
  parameters: string;
  subcontractedParameters: string;
  regulation: string;
};

export const spsDocuments = pgTable('sps_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  spsNumber: text('sps_number').notNull().unique(),
  requestId: uuid('request_id').references(() => samplingRequests.id),
  scheduleId: uuid('schedule_id').references(() => samplingSchedules.id),
  documentDate: timestamp('document_date').defaultNow().notNull(),
  customerName: text('customer_name').notNull(),
  customerAddress: text('customer_address').notNull().default(''),
  customerPhone: text('customer_phone').default('-'),
  customerPic: text('customer_pic').notNull().default('-'),
  picPhone: text('pic_phone').notNull().default('-'),
  jobName: text('job_name').notNull(),
  lhpNumber: text('lhp_number').default(''),
  contractNumber: text('contract_number').default('-'),
  samplingDateLabel: text('sampling_date_label').notNull(),
  samplingStartDate: timestamp('sampling_start_date'),
  samplingEndDate: timestamp('sampling_end_date'),
  samplingLocation: text('sampling_location').notNull(),
  assignedPersonnelNames: jsonb('assigned_personnel_names').$type<string[]>().default([]).notNull(),
  scheduleRows: jsonb('schedule_rows').$type<SpsScheduleRow[]>().default([]).notNull(),
  matrixRows: jsonb('matrix_rows').$type<SpsMatrixRow[]>().default([]).notNull(),
  notes: text('notes').default(''),
  preparedByName: text('prepared_by_name').default('SPV Sampling ANKAL'),
  revisionNumber: integer('revision_number').default(1).notNull(),
  lifecycleStatus: text('lifecycle_status').notNull().default('ACTIVE'),
  // 'ACTIVE' | 'COMPLETED' | 'PENDING_ARCHIVAL' | 'ARCHIVAL_DEFERRED' | 'ARCHIVED' | 'CANCELLED'
  archivalDeferredUntil: timestamp('archival_deferred_until'),
  archivedAt: timestamp('archived_at'),
  archivedBy: uuid('archived_by').references(() => users.id),
  isHistoricalImport: boolean('is_historical_import').default(false).notNull(),
  isImmutable: boolean('is_immutable').default(true).notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const spsRevisions = pgTable('sps_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  spsDocumentId: uuid('sps_document_id')
    .references(() => spsDocuments.id, { onDelete: 'cascade' })
    .notNull(),
  revisionNumber: integer('revision_number').notNull(),
  snapshotData: jsonb('snapshot_data').notNull(),
  changeReason: text('change_reason').notNull().default(''),
  revisedBy: uuid('revised_by').references(() => users.id),
  revisedByName: text('revised_by_name').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const spsTemplates = pgTable('sps_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  templateName: text('template_name').notNull(),
  sourceSpsId: uuid('source_sps_id').references(() => spsDocuments.id),
  originalSpsNumber: text('original_sps_number').notNull(),
  customerName: text('customer_name').notNull(),
  customerAddress: text('customer_address').default(''),
  customerPic: text('customer_pic').default(''),
  picPhone: text('pic_phone').default(''),
  jobName: text('job_name').notNull(),
  samplingLocation: text('sampling_location').default(''),
  activityDescription: text('activity_description').default('Pemantauan Lingkungan'),
  defaultNotes: text('default_notes').default(''),
  matrixConfig: jsonb('matrix_config').$type<SpsMatrixRow[]>().default([]).notNull(),
  documentLayoutRef: text('document_layout_ref').default('ANKAL-FO-7.1-01').notNull(),
  version: integer('version').default(1).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdBy: uuid('created_by').references(() => users.id),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const documentArchives = pgTable('document_archives', {
  id: uuid('id').defaultRandom().primaryKey(),
  spsDocumentId: uuid('sps_document_id')
    .references(() => spsDocuments.id, { onDelete: 'cascade' })
    .notNull(),
  spsNumber: text('sps_number').notNull(),
  customerName: text('customer_name').notNull(),
  jobName: text('job_name').notNull(),
  samplingYear: integer('sampling_year').notNull(),
  matricesSummary: text('matrices_summary').default(''),
  personnelSummary: text('personnel_summary').default(''),
  archivedBy: uuid('archived_by').references(() => users.id),
  archivedByName: text('archived_by_name').notNull(),
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
  archivalReason: text('archival_reason').default('Jadwal pengambilan contoh uji selesai'),
  restoredAt: timestamp('restored_at'),
  restoredBy: uuid('restored_by').references(() => users.id),
  isActiveArchive: boolean('is_active_archive').default(true).notNull(),
});

export const documentEvents = pgTable('document_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  spsDocumentId: uuid('sps_document_id')
    .references(() => spsDocuments.id, { onDelete: 'cascade' })
    .notNull(),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  details: jsonb('details').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const spsImportBatches = pgTable('sps_import_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalFilename: text('original_filename').notNull(),
  fileType: text('file_type').notNull(), // 'XLSX' | 'XLS' | 'CSV' | 'PDF'
  storagePath: text('storage_path').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  uploadedByName: text('uploaded_by_name').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  processingStatus: text('processing_status').notNull().default('PENDING'), // 'PENDING' | 'EXTRACTED' | 'PARTIAL' | 'COMPLETED' | 'FAILED'
  totalRecords: integer('total_records').default(0).notNull(),
  successfulRecords: integer('successful_records').default(0).notNull(),
  failedRecords: integer('failed_records').default(0).notNull(),
  duplicateRecords: integer('duplicate_records').default(0).notNull(),
  columnMapping: jsonb('column_mapping').default({}).notNull(),
});

export const spsImportRecords = pgTable('sps_import_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  batchId: uuid('batch_id')
    .references(() => spsImportBatches.id, { onDelete: 'cascade' })
    .notNull(),
  sourcePage: integer('source_page').default(1).notNull(),
  extractedData: jsonb('extracted_data').notNull(),
  confidenceData: jsonb('confidence_data').default({}).notNull(),
  validationStatus: text('validation_status').notNull().default('PENDING_REVIEW'), // 'PENDING_REVIEW' | 'DRAFT' | 'VERIFIED' | 'IMPORTED' | 'REJECTED'
  duplicateStatus: text('duplicate_status').notNull().default('NONE'), // 'NONE' | 'EXACT_NUMBER_DUPLICATE' | 'SIMILAR_RECORD' | 'RESOLVED_SEPARATE'
  duplicateSpsId: uuid('duplicate_sps_id'),
  missingFields: jsonb('missing_fields').$type<string[]>().default([]).notNull(),
  warnings: jsonb('warnings').$type<string[]>().default([]).notNull(),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  importedSpsId: uuid('imported_sps_id').references(() => spsDocuments.id),
});

export const spsSourceFiles = pgTable('sps_source_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  spsDocumentId: uuid('sps_document_id')
    .references(() => spsDocuments.id, { onDelete: 'cascade' })
    .notNull(),
  originalFilename: text('original_filename').notNull(),
  storagePath: text('storage_path').notNull(),
  sourceType: text('source_type').notNull(), // 'PDF' | 'XLSX' | 'CSV' | 'GENERATED_PDF'
  fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
});

// ============================================================================
// 7. SYSTEM (NOTIFICATIONS, AUDIT LOGS, SETTINGS)
// ============================================================================

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  recipientUserId: uuid('recipient_user_id').references(() => users.id),
  recipientRole: text('recipient_role'),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  recordNumber: text('record_number').default(''),
  description: text('description').notNull(),
  targetRoute: text('target_route').default('dashboard'),
  targetId: text('target_id').default(''),
  isRead: boolean('is_read').default(false).notNull(),
  actionRequired: boolean('action_required').default(false).notNull(),
  actionPayload: jsonb('action_payload').default({}).notNull(),
  isDemo: boolean('is_demo').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  entityNumber: text('entity_number').default(''),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description').default(''),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
