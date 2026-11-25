export type AppRole = 'KAE_SALES' | 'SPV_SAMPLING' | 'MANAGEMENT';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AppUser {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  role: AppRole;
  actualRole: AppRole;
  approvalStatus?: ApprovalStatus;
  departmentId: string | null;
  avatarUrl: string | null;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  description: string;
}

export interface Competency {
  id: string;
  code: string;
  name: string;
  matrixCategory: string;
  description: string;
}

export interface MatrixMaster {
  id: string;
  code: string;
  name: string;
  category: string;
  requiredCompetencyId: string | null;
  description: string;
}

export interface ParameterMaster {
  id: string;
  code: string;
  name: string;
  unit: string;
  matrixCategory: string;
  isSubcontractDefault: boolean;
  method: string;
}

export interface RegulationMaster {
  id: string;
  code: string;
  name: string;
  matrixCategory: string;
  year: number;
  description: string;
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  phone: string;
  picName: string;
  picPhone: string;
  email: string;
  industry: string;
}

export interface RequestMatrixParam {
  id?: string;
  parameterId?: string | null;
  parameterName: string;
  unit: string;
  isSubcontracted: boolean;
}

export interface RequestMatrixItem {
  id?: string;
  matrixId?: string | null;
  matrixName: string;
  pointCount: number;
  pointDescription: string;
  regulationId?: string | null;
  regulationName: string;
  notes?: string;
  parameters: RequestMatrixParam[];
}

export interface SamplingRequest {
  id: string;
  requestNumber: string;
  createdBy: string | null;
  createdByName: string;
  customerId: string | null;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  customerPic: string;
  picPhone: string;
  jobName: string;
  lhpNumber: string;
  contractNumber: string;
  jobDescription: string;
  proposedDate: string;
  proposedEndDate?: string | null;
  proposedTime: string;
  estimatedDurationHours: number;
  mobilizationHours: number;
  samplingLocation: string;
  specialInstructions: string;
  attachments: Array<{ name: string; size?: number; type?: string }>;
  status: string;
  sourceTemplateId: string | null;
  revisionNumber: number;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  matrices: RequestMatrixItem[];
  approvals: Array<{
    id: string;
    approverName: string;
    decision: string;
    comments: string;
    revisionNumber: number;
    createdAt: string;
  }>;
  schedules: Array<{
    id: string;
    scheduleCode: string;
    activityName: string;
    startDate: string;
    endDate: string;
    revisionNumber: number;
    isActive: boolean;
    postponeReason: string;
    notes: string;
  }>;
  assignments: Array<{
    id: string;
    personnelId: string;
    roleInTeam: string;
    assignmentStatus: string;
    assignmentMode: string;
    startDate: string;
    endDate: string;
  }>;
  spsDocument: SpsDocument | null;
  vehicleReservations: Array<{
    id: string;
    vehicleId: string;
    departureTime: string;
    returnTime: string;
    destination: string;
    status: string;
  }>;
}

export interface PersonnelRecord {
  id: string;
  code: string;
  category: 'INTERNAL' | 'EXTERNAL';
  fullName: string;
  departmentId: string | null;
  position: string;
  phone: string;
  email: string;
  baseLocation: string;
  employmentStatus: 'ACTIVE' | 'INACTIVE' | 'TERMINATED';
  fieldEligible: boolean;
  verifiedAt: string | null;
  notes: string;
  department: Department | null;
  competencies: Array<{
    id: string;
    competencyId: string;
    level: string;
    verified: boolean;
    competency: Competency | null;
  }>;
  certifications: Array<{
    id: string;
    name: string;
    issuer: string;
    certificateNumber: string;
    validUntil: string;
  }>;
}

export interface SpsScheduleRow {
  dateLabel: string;
  activity: string;
  notes: string;
}

export interface SpsMatrixRow {
  no: number;
  dateLabel: string;
  matrixName: string;
  pointCount: number;
  pointLocations: string;
  parameters: string;
  subcontractedParameters: string;
  regulation: string;
}

export interface SpsDocument {
  id: string;
  spsNumber: string;
  requestId: string | null;
  scheduleId: string | null;
  documentDate: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  customerPic: string;
  picPhone: string;
  jobName: string;
  lhpNumber: string;
  contractNumber: string;
  samplingDateLabel: string;
  samplingStartDate: string | null;
  samplingEndDate: string | null;
  samplingLocation: string;
  assignedPersonnelNames: string[];
  scheduleRows: SpsScheduleRow[];
  matrixRows: SpsMatrixRow[];
  notes: string;
  preparedByName: string;
  revisionNumber: number;
  lifecycleStatus: string;
  archivalDeferredUntil: string | null;
  archivedAt: string | null;
  isHistoricalImport: boolean;
  isImmutable: boolean;
  archivalEvaluation?: {
    shouldPromptArchival: boolean;
    effectiveEndDate: string | null;
    recommendedStatus: string;
    message: string;
  };
  revisions?: Array<{
    id: string;
    revisionNumber: number;
    changeReason: string;
    revisedByName: string;
    createdAt: string;
  }>;
  events?: Array<{
    id: string;
    eventType: string;
    actorName: string;
    createdAt: string;
  }>;
}

export interface SpsTemplate {
  id: string;
  templateName: string;
  sourceSpsId: string | null;
  originalSpsNumber: string;
  customerName: string;
  customerAddress: string;
  customerPic: string;
  picPhone: string;
  jobName: string;
  samplingLocation: string;
  activityDescription: string;
  defaultNotes: string;
  matrixConfig: SpsMatrixRow[];
  documentLayoutRef: string;
  version: number;
  lastUsedAt: string | null;
  createdAt: string;
  sourceSps?: SpsDocument | null;
}

export interface Vehicle {
  id: string;
  vehicleCode: string;
  registrationNumber: string;
  model: string;
  vehicleType: string;
  passengerCapacity: number;
  operationalStatus: 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'UNAVAILABLE';
  baseLocation: string;
  notes: string;
}

export interface NotificationItem {
  id: string;
  eventType: string;
  title: string;
  recordNumber: string;
  description: string;
  targetRoute: string;
  targetId: string;
  isRead: boolean;
  actionRequired: boolean;
  actionPayload: Record<string, unknown>;
  createdAt: string;
}
