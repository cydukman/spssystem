import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asc, desc, eq, and, inArray, sql } from 'drizzle-orm';
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
  spsImportBatches,
  spsImportRecords,
  spsRevisions,
  spsSourceFiles,
  spsTemplates,
  systemSettings,
  users,
  vehicleReservations,
  vehicles,
} from '../db/schema.ts';
import {
  MASTER_ADMIN_EMAIL,
  clearSessionCookie,
  createUserSession,
  extractAuthToken,
  findSessionUserByToken,
  hashPassword,
  requireAuth,
  requireRole,
  revokeUserSession,
  sanitizePublicUser,
  setSessionCookie,
  verifyPassword,
  type AppRole,
  type ApprovalStatus,
  type AuthRequest,
} from './auth.ts';
import { ensureMasterAndDemoData } from './seed.ts';
import { generateSpsPdfBuffer } from './pdfGenerator.ts';
import {
  extractSpsRecordsFromPdfWithAI,
  parseSpreadsheetBuffer,
  resolvePrivateUploadPath,
  savePrivateUpload,
} from './importEngine.ts';
import {
  canManualOverrideStatus,
  evaluatePersonnelAvailability,
  recommendPersonnel,
  validateVehicleReservation,
  type AssignmentWindow,
  type LeaveWindow,
  type ManualAvailabilityWindow,
  type PersonnelProfile,
} from '../lib/domain/scheduling.ts';
import {
  detectSpsDuplicate,
  evaluateSpsArchivalLifecycle,
  formatSamplingDateRangeLabel,
  formatSpsNumber,
  mapExcelRowsToSpsRecords,
} from '../lib/domain/sps.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function writeAudit(params: {
  user?: { id: string; fullName: string; role: string };
  action: string;
  entityType: string;
  entityId: string;
  entityNumber?: string;
  beforeState?: unknown;
  afterState?: unknown;
  notes?: string;
}) {
  await db.insert(auditLogs).values({
    actorUserId: params.user?.id || null,
    actorName: params.user?.fullName || 'Sistem ANKAL',
    actorRole: params.user?.role || 'SYSTEM',
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    entityNumber: params.entityNumber || '',
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
    notes: params.notes || '',
  });
}

async function createNotification(params: {
  recipientUserId?: string | null;
  recipientRole?: string | null;
  eventType: string;
  title: string;
  recordNumber?: string;
  description: string;
  targetRoute?: string;
  targetId?: string;
  actionRequired?: boolean;
  actionPayload?: Record<string, unknown>;
}) {
  await db.insert(notifications).values({
    recipientUserId: params.recipientUserId || null,
    recipientRole: params.recipientRole || null,
    eventType: params.eventType,
    title: params.title,
    recordNumber: params.recordNumber || '',
    description: params.description,
    targetRoute: params.targetRoute || 'dashboard',
    targetId: params.targetId || '',
    actionRequired: params.actionRequired ?? false,
    actionPayload: params.actionPayload ?? {},
  });
}

const requestMatrixSchema = z.object({
  matrixId: z.string().uuid().optional().nullable(),
  matrixName: z.string().min(1),
  pointCount: z.number().int().min(1),
  pointDescription: z.string().min(1),
  regulationId: z.string().uuid().optional().nullable(),
  regulationName: z.string().default('-'),
  notes: z.string().optional().default(''),
  parameters: z
    .array(
      z.object({
        parameterId: z.string().uuid().optional().nullable(),
        parameterName: z.string().min(1),
        unit: z.string().optional().default('-'),
        isSubcontracted: z.boolean().optional().default(false),
      })
    )
    .min(1),
});

const samplingRequestPayloadSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().min(2),
  customerAddress: z.string().min(2),
  customerPhone: z.string().optional().default('-'),
  customerPic: z.string().min(1),
  picPhone: z.string().min(3),
  jobName: z.string().min(2),
  lhpNumber: z.string().optional().default(''),
  contractNumber: z.string().optional().default(''),
  jobDescription: z.string().optional().default(''),
  proposedDate: z.string().min(4),
  proposedEndDate: z.string().optional().nullable(),
  proposedTime: z.string().optional().default('08:00'),
  estimatedDurationHours: z.number().int().min(1).max(720).default(8),
  mobilizationHours: z.number().int().min(0).max(72).default(2),
  samplingLocation: z.string().min(2),
  specialInstructions: z.string().optional().default(''),
  attachments: z
    .array(z.object({ name: z.string(), size: z.number().optional(), type: z.string().optional() }))
    .optional()
    .default([]),
  matrices: z.array(requestMatrixSchema).min(1),
  sourceTemplateId: z.string().uuid().optional().nullable(),
});

export function createApiRouter() {
  const router = express.Router();

  // Healthcheck (unauthenticated for Cloud Run)
  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ankal-foms' });
  });

  // ==========================================================================
  // PUBLIC EMAIL / CORPORATE DOMAIN AUTHENTICATION
  // ==========================================================================
  router.get('/auth/session', async (req, res) => {
    try {
      const { token } = extractAuthToken(req);
      if (!token || !token.startsWith('ankal_sess_')) {
        return res.json({ authenticated: false });
      }
      const dbUser = await findSessionUserByToken(token);
      if (!dbUser || dbUser.approvalStatus !== 'APPROVED' || !dbUser.isActive) {
        clearSessionCookie(req, res);
        return res.json({ authenticated: false });
      }
      return res.json({
        authenticated: true,
        token,
        user: sanitizePublicUser(dbUser),
      });
    } catch {
      return res.json({ authenticated: false });
    }
  });

  router.post('/auth/register', async (req, res) => {
    try {
      const schema = z.object({
        fullName: z.string().trim().min(2, 'Nama lengkap minimal 2 karakter').max(120),
        email: z.string().trim().email('Format email tidak valid').max(180),
        password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(128),
      });
      const parsed = schema.parse(req.body);
      const normalizedEmail = parsed.email.toLowerCase();

      const existing = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalizedEmail}`)
        .limit(1);

      if (existing.length > 0) {
        const current = existing[0];
        const isPreapprovedPlaceholder = current.uid.startsWith('preapproved:');
        if (current.passwordHash || !isPreapprovedPlaceholder) {
          return res.status(409).json({
            code: 'EMAIL_EXISTS',
            error:
              'Email ini sudah terdaftar. Silakan masuk dengan kata sandi Anda atau melalui Akun Google.',
          });
        }

        // Pre-approved by Superadmin: allow setting initial password on first claim
        const [updated] = await db
          .update(users)
          .set({
            fullName: parsed.fullName || current.fullName,
            passwordHash: hashPassword(parsed.password),
            updatedAt: new Date(),
          })
          .where(eq(users.id, current.id))
          .returning();

        if (updated.approvalStatus === 'REJECTED') {
          return res.status(403).json({
            code: 'REGISTRATION_REJECTED',
            error: 'Permintaan registrasi akun Anda ditolak oleh Superadmin.',
          });
        }

        if (updated.approvalStatus !== 'APPROVED') {
          return res.status(202).json({
            status: 'PENDING',
            code: 'REGISTRATION_PENDING',
            email: updated.email,
            message: 'Registrasi tercatat dan sedang menunggu persetujuan Superadmin.',
          });
        }

        if (!updated.isActive) {
          return res.status(403).json({
            code: 'ACCOUNT_INACTIVE',
            error: 'Akun pengguna dinonaktifkan oleh Superadmin.',
          });
        }

        const { token } = await createUserSession(updated.id);
        setSessionCookie(req, res, token);
        return res.status(200).json({
          status: 'APPROVED',
          token,
          user: sanitizePublicUser(updated),
        });
      }

      const isInitialMaster = normalizedEmail === MASTER_ADMIN_EMAIL;
      const initialRole: AppRole = isInitialMaster ? 'MANAGEMENT' : 'KAE_SALES';
      const initialApproval: ApprovalStatus = isInitialMaster ? 'APPROVED' : 'PENDING';

      const [created] = await db
        .insert(users)
        .values({
          uid: `local:${crypto.randomUUID()}`,
          email: normalizedEmail,
          fullName: parsed.fullName,
          passwordHash: hashPassword(parsed.password),
          role: initialRole,
          approvalStatus: initialApproval,
          approvedAt: isInitialMaster ? new Date() : null,
          isActive: true,
        })
        .returning();

      if (created.approvalStatus === 'PENDING') {
        await createNotification({
          recipientRole: 'MANAGEMENT',
          eventType: 'USER_REGISTRATION_PENDING',
          title: 'Permintaan Registrasi Pengguna Baru',
          recordNumber: created.email,
          description: `${created.fullName} (${created.email}) mendaftar melalui email & menunggu persetujuan Superadmin.`,
          targetRoute: 'users',
          targetId: created.id,
          actionRequired: true,
        });

        await writeAudit({
          action: 'USER_REGISTERED_PENDING',
          entityType: 'USER',
          entityId: created.id,
          entityNumber: created.email,
          notes: 'Pendaftaran email domain mandiri menunggu persetujuan Superadmin',
        });

        return res.status(201).json({
          status: 'PENDING',
          code: 'REGISTRATION_PENDING',
          email: created.email,
          message: 'Registrasi berhasil dikirim. Akun menunggu persetujuan Superadmin sebelum dapat masuk.',
        });
      }

      const { token } = await createUserSession(created.id);
      setSessionCookie(req, res, token);
      return res.status(201).json({
        status: 'APPROVED',
        token,
        user: sanitizePublicUser(created),
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues[0]?.message || 'Data pendaftaran tidak valid.' });
      }
      console.error('Error in POST /api/auth/register:', error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Gagal mendaftarkan akun.',
      });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().trim().email('Format email tidak valid'),
        password: z.string().min(1, 'Kata sandi wajib diisi'),
      });
      const { email, password } = schema.parse(req.body);
      const normalizedEmail = email.toLowerCase();

      const [found] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalizedEmail}`)
        .limit(1);

      if (!found || !found.passwordHash || !verifyPassword(password, found.passwordHash)) {
        return res.status(401).json({
          code: 'INVALID_CREDENTIALS',
          error: 'Email atau kata sandi salah. Jika akun terdaftar via Google tanpa kata sandi, gunakan Masuk dengan Google.',
        });
      }

      if (found.approvalStatus === 'REJECTED') {
        return res.status(403).json({
          code: 'REGISTRATION_REJECTED',
          email: found.email,
          error: 'Permintaan registrasi akun Anda ditolak oleh Superadmin.',
        });
      }

      if (found.approvalStatus !== 'APPROVED') {
        return res.status(403).json({
          code: 'REGISTRATION_PENDING',
          email: found.email,
          error: 'Registrasi akun Anda sedang menunggu persetujuan Superadmin. Hubungi administrator PT ANKAL untuk aktivasi.',
        });
      }

      if (!found.isActive) {
        return res.status(403).json({
          code: 'ACCOUNT_INACTIVE',
          email: found.email,
          error: 'Akun pengguna dinonaktifkan oleh administrator.',
        });
      }

      const { token } = await createUserSession(found.id);
      setSessionCookie(req, res, token);
      return res.json({
        token,
        user: sanitizePublicUser(found),
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues[0]?.message || 'Input login tidak valid.' });
      }
      console.error('Error in POST /api/auth/login:', error);
      return res.status(400).json({ error: 'Gagal memproses login.' });
    }
  });

  router.post('/auth/logout', async (req, res) => {
    try {
      const { token } = extractAuthToken(req);
      if (token.startsWith('ankal_sess_')) {
        await revokeUserSession(token);
      }
      clearSessionCookie(req, res);
      return res.json({ ok: true });
    } catch {
      clearSessionCookie(req, res);
      return res.json({ ok: true });
    }
  });

  // All business endpoints require verified Firebase ID token or DB session
  router.use(requireAuth);

  // ==========================================================================
  // AUTH & CURRENT USER
  // ==========================================================================
  router.get('/me', async (req: AuthRequest, res) => {
    try {
      await ensureMasterAndDemoData(req.appUser!.id, false);
      res.json({ user: req.appUser });
    } catch (error) {
      console.error('Error in GET /api/me:', error);
      res.status(500).json({ error: 'Gagal memuat profil pengguna.' });
    }
  });

  // ==========================================================================
  // DASHBOARD (Real Database Aggregations by Role)
  // ==========================================================================
  router.get('/dashboard', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const [allReqs, allPers, allAssigns, allVehs, allRes, allSps, allSchedules, allNotifs] =
        await Promise.all([
          db.select().from(samplingRequests).orderBy(desc(samplingRequests.createdAt)),
          db.select().from(personnel),
          db.select().from(personnelAssignments),
          db.select().from(vehicles),
          db.select().from(vehicleReservations),
          db.select().from(spsDocuments),
          db.select().from(samplingSchedules),
          db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(25),
        ]);

      const now = new Date();

      // Re-evaluate SPS pending archival status dynamically against latest approved schedules
      const spsEvaluated = allSps.map((doc) => {
        const reqSchedules = allSchedules
          .filter((s) => s.requestId === doc.requestId && s.isActive)
          .sort((a, b) => b.revisionNumber - a.revisionNumber);
        const latestEnd = reqSchedules[0]?.endDate ?? doc.samplingEndDate;
        const evalResult = evaluateSpsArchivalLifecycle({
          spsNumber: doc.spsNumber,
          lifecycleStatus: doc.lifecycleStatus,
          originalEndDate: doc.samplingEndDate,
          latestApprovedScheduleEndDate: latestEnd,
          archivalDeferredUntil: doc.archivalDeferredUntil,
          now,
        });
        return { ...doc, evaluatedArchival: evalResult };
      });

      const activeAssignments = allAssigns.filter(
        (a) => a.assignmentStatus === 'CONFIRMED' || a.assignmentStatus === 'TENTATIVE'
      );

      // Count overlapping confirmed assignments
      let conflictCount = 0;
      const confirmedByPerson = new Map<string, typeof activeAssignments>();
      for (const a of activeAssignments.filter((x) => x.assignmentStatus === 'CONFIRMED')) {
        const list = confirmedByPerson.get(a.personnelId) || [];
        list.push(a);
        confirmedByPerson.set(a.personnelId, list);
      }
      for (const [, list] of confirmedByPerson) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            if (
              list[i].startDate.getTime() < list[j].endDate.getTime() &&
              list[j].startDate.getTime() < list[i].endDate.getTime()
            ) {
              conflictCount++;
            }
          }
        }
      }

      const assignedPersonnelIds = new Set(
        activeAssignments
          .filter((a) => a.endDate.getTime() >= now.getTime())
          .map((a) => a.personnelId)
      );

      const internalPersonnel = allPers.filter((p) => p.category === 'INTERNAL' && p.employmentStatus === 'ACTIVE');
      const externalPersonnel = allPers.filter((p) => p.category === 'EXTERNAL' && p.employmentStatus === 'ACTIVE' && p.fieldEligible);

      const availableInternal = internalPersonnel.filter((p) => !assignedPersonnelIds.has(p.id)).length;
      const availableFreelance = externalPersonnel.filter((p) => !assignedPersonnelIds.has(p.id)).length;

      const availableVehicles = allVehs.filter((v) => v.operationalStatus === 'AVAILABLE').length;
      const activeVehicleReservations = allRes.filter(
        (r) => r.status === 'RESERVED' || r.status === 'IN_USE'
      ).length;

      const upcomingSchedules = allSchedules.filter(
        (s) => s.isActive && s.endDate.getTime() >= now.getTime()
      );

      const spsAwaitingGeneration = allReqs.filter(
        (r) =>
          (r.status === 'ASSIGNED' || r.status === 'SCHEDULED') &&
          !allSps.some((d) => d.requestId === r.id)
      ).length;

      const spsPendingArchival = spsEvaluated.filter(
        (d) =>
          d.lifecycleStatus === 'PENDING_ARCHIVAL' ||
          d.evaluatedArchival.shouldPromptArchival
      );

      const myRequests = allReqs.filter((r) => r.createdBy === req.appUser!.id || r.isDemo);

      res.json({
        role: req.appUser!.role,
        kae: {
          myRequestsCount: myRequests.length,
          draftCount: myRequests.filter((r) => r.status === 'DRAFT').length,
          awaitingApprovalCount: myRequests.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW').length,
          revisionCount: myRequests.filter((r) => r.status === 'REVISION_REQUESTED').length,
          approvedCount: myRequests.filter((r) => ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status)).length,
          upcomingSamplingCount: upcomingSchedules.length,
          activeSpsCount: spsEvaluated.filter((d) => d.lifecycleStatus !== 'ARCHIVED').length,
          archivedSpsCount: spsEvaluated.filter((d) => d.lifecycleStatus === 'ARCHIVED').length,
        },
        spv: {
          incomingRequestsCount: allReqs.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW').length,
          awaitingReviewCount: allReqs.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW' || r.status === 'REVISION_REQUESTED').length,
          awaitingAssignmentCount: allReqs.filter((r) => r.status === 'APPROVED').length,
          upcomingSamplingCount: upcomingSchedules.length,
          availableInternalCount: availableInternal,
          availableFreelanceCount: availableFreelance,
          assignedPersonnelCount: assignedPersonnelIds.size,
          conflictCount,
          availableVehiclesCount: availableVehicles,
          totalVehiclesCount: allVehs.length,
          spsAwaitingGenerationCount: spsAwaitingGeneration,
          spsAwaitingArchivalCount: spsPendingArchival.length,
        },
        management: {
          totalJobs: allReqs.filter((r) => ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED'].includes(r.status)).length,
          totalRequests: allReqs.length,
          approvedJobs: allReqs.filter((r) => ['APPROVED', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS'].includes(r.status)).length,
          pendingRequests: allReqs.filter((r) => ['SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED'].includes(r.status)).length,
          completedJobs: allReqs.filter((r) => r.status === 'COMPLETED' || r.status === 'ARCHIVED').length,
          personnelUtilizationPct:
            allPers.length > 0 ? Math.round((assignedPersonnelIds.size / allPers.length) * 100) : 0,
          internalAssignmentsCount: activeAssignments.filter((a) =>
            internalPersonnel.some((p) => p.id === a.personnelId)
          ).length,
          freelanceAssignmentsCount: activeAssignments.filter((a) =>
            externalPersonnel.some((p) => p.id === a.personnelId)
          ).length,
          vehicleUtilizationPct:
            allVehs.length > 0 ? Math.min(100, Math.round((activeVehicleReservations / allVehs.length) * 100)) : 0,
        },
        recentRequests: allReqs.slice(0, 8),
        upcomingSchedules: upcomingSchedules.slice(0, 6),
        pendingArchivalSps: spsPendingArchival,
        unreadNotificationsCount: allNotifs.filter((n) => !n.isRead).length,
      });
    } catch (error) {
      console.error('Error in GET /api/dashboard:', error);
      res.status(500).json({ error: 'Gagal memuat data dasbor operasional.' });
    }
  });

  // ==========================================================================
  // MASTER DATA (Customers, Matrices, Parameters, Regulations, Competencies)
  // ==========================================================================
  router.get('/master', async (_req, res) => {
    try {
      const [deptRows, compRows, matrixRows, paramRows, regRows, custRows] = await Promise.all([
        db.select().from(departments).orderBy(departments.name),
        db.select().from(competencies).orderBy(competencies.code),
        db.select().from(matrices).orderBy(matrices.name),
        db.select().from(parameters).orderBy(parameters.name),
        db.select().from(regulations).orderBy(regulations.name),
        db.select().from(customers).orderBy(customers.name),
      ]);
      res.json({
        departments: deptRows,
        competencies: compRows,
        matrices: matrixRows,
        parameters: paramRows,
        regulations: regRows,
        customers: custRows,
      });
    } catch (error) {
      console.error('Error in GET /api/master:', error);
      res.status(500).json({ error: 'Gagal memuat master data.' });
    }
  });

  router.post('/master/customers', async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        address: z.string().default(''),
        phone: z.string().optional().default('-'),
        picName: z.string().min(1),
        picPhone: z.string().min(3),
        email: z.string().optional().default(''),
        industry: z.string().optional().default(''),
      });
      const parsed = schema.parse(req.body);
      const [created] = await db.insert(customers).values(parsed).returning();
      await writeAudit({
        user: req.appUser,
        action: 'CREATE_CUSTOMER',
        entityType: 'CUSTOMER',
        entityId: created.id,
        entityNumber: created.name,
        afterState: created,
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Data pelanggan tidak valid.' });
    }
  });

  router.post('/master/matrices', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        code: z.string().min(2),
        name: z.string().min(2),
        category: z.string().min(2),
        requiredCompetencyId: z.string().uuid().optional().nullable(),
        description: z.string().optional().default(''),
      });
      const parsed = schema.parse(req.body);
      const [created] = await db.insert(matrices).values(parsed).returning();
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menambah matriks.' });
    }
  });

  router.post('/master/parameters', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        code: z.string().min(2),
        name: z.string().min(1),
        unit: z.string().default('-'),
        matrixCategory: z.string().min(2),
        isSubcontractDefault: z.boolean().default(false),
        method: z.string().optional().default(''),
      });
      const parsed = schema.parse(req.body);
      const [created] = await db.insert(parameters).values(parsed).returning();
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menambah parameter.' });
    }
  });

  router.post('/master/regulations', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        code: z.string().min(2),
        name: z.string().min(2),
        matrixCategory: z.string().min(2),
        year: z.number().int().optional().default(2025),
        description: z.string().optional().default(''),
      });
      const parsed = schema.parse(req.body);
      const [created] = await db.insert(regulations).values(parsed).returning();
      res.status(201).json(created);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menambah regulasi.' });
    }
  });

  // ==========================================================================
  // SAMPLING REQUESTS & APPROVAL WORKFLOW
  // ==========================================================================
  router.get('/requests', async (_req, res) => {
    try {
      const [reqs, allMats, allParams, allApprovals, allSchedules, allAssigns, allSps, allVehRes] =
        await Promise.all([
          db.select().from(samplingRequests).orderBy(desc(samplingRequests.createdAt)),
          db.select().from(requestMatrices).orderBy(requestMatrices.sortOrder),
          db.select().from(requestMatrixParameters),
          db.select().from(requestApprovals).orderBy(desc(requestApprovals.createdAt)),
          db.select().from(samplingSchedules).orderBy(desc(samplingSchedules.revisionNumber)),
          db.select().from(personnelAssignments),
          db.select().from(spsDocuments),
          db.select().from(vehicleReservations),
        ]);

      const enriched = reqs.map((r) => {
        const mats = allMats
          .filter((m) => m.requestId === r.id)
          .map((m) => ({
            ...m,
            parameters: allParams.filter((p) => p.requestMatrixId === m.id),
          }));
        const approvals = allApprovals.filter((a) => a.requestId === r.id);
        const schedules = allSchedules.filter((s) => s.requestId === r.id);
        const assignments = allAssigns.filter(
          (a) => a.requestId === r.id && a.assignmentStatus !== 'REPLACED' && a.assignmentStatus !== 'CANCELLED'
        );
        const sps = allSps.find((d) => d.requestId === r.id) || null;
        const vehicleRes = allVehRes.filter((v) => v.requestId === r.id && v.status !== 'CANCELLED');
        return {
          ...r,
          matrices: mats,
          approvals,
          schedules,
          assignments,
          spsDocument: sps,
          vehicleReservations: vehicleRes,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error('Error in GET /api/requests:', error);
      res.status(500).json({ error: 'Gagal memuat daftar permintaan sampling.' });
    }
  });

  router.post('/requests', async (req: AuthRequest, res) => {
    try {
      const parsed = samplingRequestPayloadSchema.parse(req.body);
      const submitImmediately = Boolean(req.body.submitImmediately);

      const created = await db.transaction(async (tx) => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const seqSuffix = `${Date.now().toString().slice(-4)}`;
        const requestNumber = `REQ/AKL/${year}/${month}/${seqSuffix}`;

        const startDt = new Date(parsed.proposedDate);
        const rawEndDt = parsed.proposedEndDate ? new Date(parsed.proposedEndDate) : null;
        const endDt =
          rawEndDt && !Number.isNaN(rawEndDt.getTime()) && rawEndDt.getTime() >= startDt.getTime()
            ? rawEndDt
            : new Date(startDt.getTime() + parsed.estimatedDurationHours * 3600 * 1000);

        const [reqRow] = await tx
          .insert(samplingRequests)
          .values({
            requestNumber,
            createdBy: req.appUser!.id,
            createdByName: req.appUser!.fullName,
            customerId: parsed.customerId || null,
            customerName: parsed.customerName,
            customerAddress: parsed.customerAddress,
            customerPhone: parsed.customerPhone,
            customerPic: parsed.customerPic,
            picPhone: parsed.picPhone,
            jobName: parsed.jobName,
            lhpNumber: parsed.lhpNumber,
            contractNumber: parsed.contractNumber,
            jobDescription: parsed.jobDescription,
            proposedDate: startDt,
            proposedEndDate: endDt,
            proposedTime: parsed.proposedTime,
            estimatedDurationHours: parsed.estimatedDurationHours,
            mobilizationHours: parsed.mobilizationHours,
            samplingLocation: parsed.samplingLocation,
            specialInstructions: parsed.specialInstructions,
            attachments: parsed.attachments,
            status: submitImmediately ? 'SUBMITTED' : 'DRAFT',
            sourceTemplateId: parsed.sourceTemplateId || null,
            revisionNumber: 1,
          })
          .returning();

        for (let i = 0; i < parsed.matrices.length; i++) {
          const m = parsed.matrices[i];
          const [insertedM] = await tx
            .insert(requestMatrices)
            .values({
              requestId: reqRow.id,
              matrixId: m.matrixId || null,
              matrixName: m.matrixName,
              pointCount: m.pointCount,
              pointDescription: m.pointDescription,
              regulationId: m.regulationId || null,
              regulationName: m.regulationName,
              notes: m.notes,
              sortOrder: i,
            })
            .returning();

          await tx.insert(requestMatrixParameters).values(
            m.parameters.map((p) => ({
              requestMatrixId: insertedM.id,
              parameterId: p.parameterId || null,
              parameterName: p.parameterName,
              unit: p.unit,
              isSubcontracted: p.isSubcontracted,
            }))
          );
        }

        if (submitImmediately) {
          await tx.insert(requestApprovals).values({
            requestId: reqRow.id,
            approverId: req.appUser!.id,
            approverName: req.appUser!.fullName,
            decision: 'SUBMITTED',
            comments: 'Diajukan untuk review SPV Sampling.',
            revisionNumber: 1,
          });
        }

        return reqRow;
      });

      if (submitImmediately) {
        await createNotification({
          recipientRole: 'SPV_SAMPLING',
          eventType: 'REQUEST_SUBMITTED',
          title: 'Permintaan Sampling Baru Diajukan',
          recordNumber: created.requestNumber,
          description: `${created.customerName} — ${created.jobName} menunggu persetujuan SPV Sampling.`,
          targetRoute: 'requests',
          targetId: created.id,
          actionRequired: true,
        });
      }

      await writeAudit({
        user: req.appUser,
        action: submitImmediately ? 'SUBMIT_SAMPLING_REQUEST' : 'CREATE_SAMPLING_REQUEST_DRAFT',
        entityType: 'SAMPLING_REQUEST',
        entityId: created.id,
        entityNumber: created.requestNumber,
        afterState: created,
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      console.error('Error in POST /api/requests:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal membuat permintaan sampling.' });
    }
  });

  router.put('/requests/:id', async (req: AuthRequest, res) => {
    try {
      const requestId = String(req.params.id);
      const existing = await db
        .select()
        .from(samplingRequests)
        .where(eq(samplingRequests.id, requestId))
        .limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Permintaan sampling tidak ditemukan.' });
      }
      const current = existing[0];
      if (
        req.appUser!.role === 'KAE_SALES' &&
        current.status !== 'DRAFT' &&
        current.status !== 'REVISION_REQUESTED'
      ) {
        return res.status(403).json({
          error: 'KAE/Sales hanya dapat mengubah permintaan dalam status Draft atau Diminta Revisi.',
        });
      }

      const parsed = samplingRequestPayloadSchema.parse(req.body);
      const submitImmediately = Boolean(req.body.submitImmediately);

      const updated = await db.transaction(async (tx) => {
        const nextStatus = submitImmediately ? 'SUBMITTED' : current.status;
        const nextRev =
          current.status === 'REVISION_REQUESTED' && submitImmediately
            ? current.revisionNumber + 1
            : current.revisionNumber;

        const startDt = new Date(parsed.proposedDate);
        const rawEndDt = parsed.proposedEndDate ? new Date(parsed.proposedEndDate) : null;
        const endDt =
          rawEndDt && !Number.isNaN(rawEndDt.getTime()) && rawEndDt.getTime() >= startDt.getTime()
            ? rawEndDt
            : new Date(startDt.getTime() + parsed.estimatedDurationHours * 3600 * 1000);

        const [row] = await tx
          .update(samplingRequests)
          .set({
            customerId: parsed.customerId || null,
            customerName: parsed.customerName,
            customerAddress: parsed.customerAddress,
            customerPhone: parsed.customerPhone,
            customerPic: parsed.customerPic,
            picPhone: parsed.picPhone,
            jobName: parsed.jobName,
            lhpNumber: parsed.lhpNumber,
            contractNumber: parsed.contractNumber,
            jobDescription: parsed.jobDescription,
            proposedDate: startDt,
            proposedEndDate: endDt,
            proposedTime: parsed.proposedTime,
            estimatedDurationHours: parsed.estimatedDurationHours,
            mobilizationHours: parsed.mobilizationHours,
            samplingLocation: parsed.samplingLocation,
            specialInstructions: parsed.specialInstructions,
            attachments: parsed.attachments,
            status: nextStatus,
            revisionNumber: nextRev,
            updatedAt: new Date(),
          })
          .where(eq(samplingRequests.id, requestId))
          .returning();

        await tx.delete(requestMatrices).where(eq(requestMatrices.requestId, requestId));

        for (let i = 0; i < parsed.matrices.length; i++) {
          const m = parsed.matrices[i];
          const [insertedM] = await tx
            .insert(requestMatrices)
            .values({
              requestId,
              matrixId: m.matrixId || null,
              matrixName: m.matrixName,
              pointCount: m.pointCount,
              pointDescription: m.pointDescription,
              regulationId: m.regulationId || null,
              regulationName: m.regulationName,
              notes: m.notes,
              sortOrder: i,
            })
            .returning();

          await tx.insert(requestMatrixParameters).values(
            m.parameters.map((p) => ({
              requestMatrixId: insertedM.id,
              parameterId: p.parameterId || null,
              parameterName: p.parameterName,
              unit: p.unit,
              isSubcontracted: p.isSubcontracted,
            }))
          );
        }

        if (submitImmediately) {
          await tx.insert(requestApprovals).values({
            requestId,
            approverId: req.appUser!.id,
            approverName: req.appUser!.fullName,
            decision: 'SUBMITTED',
            comments: 'Diajukan ulang setelah revisi.',
            revisionNumber: nextRev,
          });
        }

        return row;
      });

      if (submitImmediately) {
        await createNotification({
          recipientRole: 'SPV_SAMPLING',
          eventType: 'REQUEST_SUBMITTED',
          title: 'Permintaan Sampling Diajukan Ulang',
          recordNumber: updated.requestNumber,
          description: `${updated.customerName} — ${updated.jobName} siap ditinjau kembali oleh SPV.`,
          targetRoute: 'requests',
          targetId: updated.id,
          actionRequired: true,
        });
      }

      await writeAudit({
        user: req.appUser,
        action: 'UPDATE_SAMPLING_REQUEST',
        entityType: 'SAMPLING_REQUEST',
        entityId: updated.id,
        entityNumber: updated.requestNumber,
        beforeState: current,
        afterState: updated,
      });

      res.json(updated);
    } catch (error: unknown) {
      console.error('Error in PUT /api/requests/:id:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memperbarui permintaan.' });
    }
  });

  router.post('/requests/:id/submit', async (req: AuthRequest, res) => {
    try {
      const requestId = String(req.params.id);
      const [existing] = await db
        .select()
        .from(samplingRequests)
        .where(eq(samplingRequests.id, requestId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });

      const nextRev =
        existing.status === 'REVISION_REQUESTED'
          ? existing.revisionNumber + 1
          : existing.revisionNumber;

      const [updated] = await db
        .update(samplingRequests)
        .set({ status: 'SUBMITTED', revisionNumber: nextRev, updatedAt: new Date() })
        .where(eq(samplingRequests.id, requestId))
        .returning();

      await db.insert(requestApprovals).values({
        requestId,
        approverId: req.appUser!.id,
        approverName: req.appUser!.fullName,
        decision: 'SUBMITTED',
        comments: 'Permintaan diajukan ke antrean persetujuan SPV Sampling.',
        revisionNumber: nextRev,
      });

      await createNotification({
        recipientRole: 'SPV_SAMPLING',
        eventType: 'REQUEST_SUBMITTED',
        title: 'Permintaan Sampling Baru Masuk',
        recordNumber: updated.requestNumber,
        description: `${updated.customerName} — ${updated.jobName} menunggu persetujuan SPV Sampling.`,
        targetRoute: 'requests',
        targetId: updated.id,
        actionRequired: true,
      });

      await writeAudit({
        user: req.appUser,
        action: 'SUBMIT_SAMPLING_REQUEST',
        entityType: 'SAMPLING_REQUEST',
        entityId: updated.id,
        entityNumber: updated.requestNumber,
      });

      res.json(updated);
    } catch (error) {
      console.error('Error in POST /api/requests/:id/submit:', error);
      res.status(500).json({ error: 'Gagal mengajukan permintaan.' });
    }
  });

  router.post('/requests/:id/duplicate', async (req: AuthRequest, res) => {
    try {
      const sourceId = String(req.params.id);
      const [source] = await db
        .select()
        .from(samplingRequests)
        .where(eq(samplingRequests.id, sourceId))
        .limit(1);
      if (!source) return res.status(404).json({ error: 'Permintaan sumber tidak ditemukan.' });

      const sourceMats = await db
        .select()
        .from(requestMatrices)
        .where(eq(requestMatrices.requestId, sourceId));
      const matIds = sourceMats.map((m) => m.id);
      const sourceParams =
        matIds.length > 0
          ? await db
              .select()
              .from(requestMatrixParameters)
              .where(inArray(requestMatrixParameters.requestMatrixId, matIds))
          : [];

      const duplicated = await db.transaction(async (tx) => {
        const now = new Date();
        const requestNumber = `REQ/AKL/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${Date.now().toString().slice(-4)}`;
        const nextStart = new Date(Date.now() + 7 * 86400000);
        const spanMs =
          source.proposedEndDate && source.proposedEndDate.getTime() > source.proposedDate.getTime()
            ? source.proposedEndDate.getTime() - source.proposedDate.getTime()
            : (source.estimatedDurationHours || 8) * 3600 * 1000;
        const [newReq] = await tx
          .insert(samplingRequests)
          .values({
            requestNumber,
            createdBy: req.appUser!.id,
            createdByName: req.appUser!.fullName,
            customerId: source.customerId,
            customerName: source.customerName,
            customerAddress: source.customerAddress,
            customerPhone: source.customerPhone,
            customerPic: source.customerPic,
            picPhone: source.picPhone,
            jobName: `${source.jobName} (Salinan)`,
            lhpNumber: '',
            contractNumber: source.contractNumber,
            jobDescription: source.jobDescription,
            proposedDate: nextStart,
            proposedEndDate: new Date(nextStart.getTime() + spanMs),
            proposedTime: source.proposedTime,
            estimatedDurationHours: source.estimatedDurationHours,
            mobilizationHours: source.mobilizationHours,
            samplingLocation: source.samplingLocation,
            specialInstructions: source.specialInstructions,
            status: 'DRAFT',
            revisionNumber: 1,
          })
          .returning();

        for (const m of sourceMats) {
          const [newM] = await tx
            .insert(requestMatrices)
            .values({
              requestId: newReq.id,
              matrixId: m.matrixId,
              matrixName: m.matrixName,
              pointCount: m.pointCount,
              pointDescription: m.pointDescription,
              regulationId: m.regulationId,
              regulationName: m.regulationName,
              notes: m.notes,
              sortOrder: m.sortOrder,
            })
            .returning();

          const paramsForMat = sourceParams.filter((p) => p.requestMatrixId === m.id);
          if (paramsForMat.length > 0) {
            await tx.insert(requestMatrixParameters).values(
              paramsForMat.map((p) => ({
                requestMatrixId: newM.id,
                parameterId: p.parameterId,
                parameterName: p.parameterName,
                unit: p.unit,
                isSubcontracted: p.isSubcontracted,
              }))
            );
          }
        }
        return newReq;
      });

      await writeAudit({
        user: req.appUser,
        action: 'DUPLICATE_SAMPLING_REQUEST',
        entityType: 'SAMPLING_REQUEST',
        entityId: duplicated.id,
        entityNumber: duplicated.requestNumber,
        notes: `Duplikasi dari ${source.requestNumber}`,
      });

      res.status(201).json(duplicated);
    } catch (error) {
      console.error('Error in POST /api/requests/:id/duplicate:', error);
      res.status(500).json({ error: 'Gagal menduplikasi permintaan sampling.' });
    }
  });

  router.post(
    '/requests/:id/review',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          decision: z.enum(['APPROVED', 'REVISION_REQUESTED', 'REJECTED', 'UNDER_REVIEW']),
          comments: z.string().min(1, 'Catatan keputusan wajib diisi'),
        });
        const { decision, comments } = schema.parse(req.body);
        const requestId = String(req.params.id);

        const [existing] = await db
          .select()
          .from(samplingRequests)
          .where(eq(samplingRequests.id, requestId))
          .limit(1);
        if (!existing) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });

        const result = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(samplingRequests)
            .set({ status: decision, updatedAt: new Date() })
            .where(eq(samplingRequests.id, requestId))
            .returning();

          await tx.insert(requestApprovals).values({
            requestId,
            approverId: req.appUser!.id,
            approverName: req.appUser!.fullName,
            decision,
            comments,
            revisionNumber: existing.revisionNumber,
          });

          // Create an active schedule record upon approval if none exists
          if (decision === 'APPROVED') {
            const existingSch = await tx
              .select()
              .from(samplingSchedules)
              .where(eq(samplingSchedules.requestId, requestId))
              .limit(1);
            if (existingSch.length === 0) {
              const start = new Date(existing.proposedDate);
              const end =
                existing.proposedEndDate && existing.proposedEndDate.getTime() > start.getTime()
                  ? new Date(existing.proposedEndDate)
                  : new Date(start.getTime() + (existing.estimatedDurationHours || 8) * 3600 * 1000);
              await tx.insert(samplingSchedules).values({
                requestId,
                scheduleCode: `SCH-${existing.requestNumber.replaceAll('/', '-')}`,
                activityName: existing.jobName,
                startDate: start,
                endDate: end,
                mobilizationBufferHours: existing.mobilizationHours ?? 2,
                returnBufferHours: 2,
                revisionNumber: 1,
                isActive: true,
                notes: comments,
              });
            }
          }

          return updated;
        });

        const notifMap: Record<string, { eventType: string; title: string }> = {
          APPROVED: {
            eventType: 'REQUEST_APPROVED',
            title: 'Permintaan Sampling Disetujui',
          },
          REVISION_REQUESTED: {
            eventType: 'REVISION_REQUESTED',
            title: 'Permintaan Dikembalikan untuk Revisi',
          },
          REJECTED: {
            eventType: 'REQUEST_REJECTED',
            title: 'Permintaan Sampling Ditolak',
          },
          UNDER_REVIEW: {
            eventType: 'REQUEST_UNDER_REVIEW',
            title: 'Permintaan Sedang Ditinjau SPV',
          },
        };

        await createNotification({
          recipientUserId: existing.createdBy,
          recipientRole: 'KAE_SALES',
          eventType: notifMap[decision].eventType,
          title: notifMap[decision].title,
          recordNumber: existing.requestNumber,
          description: `${existing.customerName}: ${comments}`,
          targetRoute: 'requests',
          targetId: existing.id,
          actionRequired: decision === 'REVISION_REQUESTED',
        });

        await writeAudit({
          user: req.appUser,
          action: `REVIEW_REQUEST_${decision}`,
          entityType: 'SAMPLING_REQUEST',
          entityId: existing.id,
          entityNumber: existing.requestNumber,
          beforeState: { status: existing.status },
          afterState: { status: decision },
          notes: comments,
        });

        res.json(result);
      } catch (error: unknown) {
        console.error('Error in POST /api/requests/:id/review:', error);
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memproses keputusan.' });
      }
    }
  );

  // Schedule Revision / Postponement (Scenario 13)
  router.post(
    '/requests/:id/schedule-revision',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          newStartDate: z.string().min(4),
          newEndDate: z.string().min(4),
          postponeReason: z.string().min(2),
        });
        const { newStartDate, newEndDate, postponeReason } = schema.parse(req.body);
        const requestId = String(req.params.id);

        const [reqRow] = await db
          .select()
          .from(samplingRequests)
          .where(eq(samplingRequests.id, requestId))
          .limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });

        const newStart = new Date(newStartDate);
        const newEnd = new Date(newEndDate);
        if (newEnd.getTime() <= newStart.getTime()) {
          return res.status(400).json({ error: 'Tanggal selesai harus setelah tanggal mulai.' });
        }

        const updatedSch = await db.transaction(async (tx) => {
          const prevSchedules = await tx
            .select()
            .from(samplingSchedules)
            .where(eq(samplingSchedules.requestId, requestId))
            .orderBy(desc(samplingSchedules.revisionNumber));

          const nextRev = (prevSchedules[0]?.revisionNumber || 0) + 1;
          await tx
            .update(samplingSchedules)
            .set({ isActive: false })
            .where(eq(samplingSchedules.requestId, requestId));

          const [createdSch] = await tx
            .insert(samplingSchedules)
            .values({
              requestId,
              scheduleCode: `SCH-${reqRow.requestNumber.replaceAll('/', '-')}-REV${nextRev}`,
              activityName: reqRow.jobName,
              startDate: newStart,
              endDate: newEnd,
              mobilizationBufferHours: reqRow.mobilizationHours ?? 2,
              returnBufferHours: 2,
              revisionNumber: nextRev,
              isActive: true,
              postponeReason,
              notes: `Revisi jadwal disetujui oleh ${req.appUser!.fullName}`,
            })
            .returning();

          await tx.insert(requestApprovals).values({
            requestId,
            approverId: req.appUser!.id,
            approverName: req.appUser!.fullName,
            decision: 'SCHEDULE_REVISED',
            comments: `Jadwal diperbarui ke ${newStart.toLocaleDateString('id-ID')} - ${newEnd.toLocaleDateString('id-ID')}. Alasan: ${postponeReason}`,
            revisionNumber: nextRev,
          });

          // Update active SPS schedule link if present and reset premature PENDING_ARCHIVAL
          const linkedSps = await tx
            .select()
            .from(spsDocuments)
            .where(eq(spsDocuments.requestId, requestId));
          for (const sps of linkedSps) {
            if (sps.lifecycleStatus !== 'ARCHIVED') {
              await tx
                .update(spsDocuments)
                .set({
                  scheduleId: createdSch.id,
                  samplingDateLabel: `${newStart.toLocaleDateString('id-ID', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })} (Jadwal Revisi)`,
                  lifecycleStatus: 'ACTIVE',
                  archivalDeferredUntil: null,
                  updatedAt: new Date(),
                })
                .where(eq(spsDocuments.id, sps.id));
            }
          }

          return createdSch;
        });

        await createNotification({
          recipientRole: 'KAE_SALES',
          eventType: 'SCHEDULE_CHANGED',
          title: 'Jadwal Sampling Diperbarui / Ditunda',
          recordNumber: reqRow.requestNumber,
          description: `${reqRow.customerName}: ${postponeReason}`,
          targetRoute: 'gantt',
          targetId: reqRow.id,
        });

        await writeAudit({
          user: req.appUser,
          action: 'REVISE_SAMPLING_SCHEDULE',
          entityType: 'SAMPLING_SCHEDULE',
          entityId: updatedSch.id,
          entityNumber: updatedSch.scheduleCode,
          afterState: updatedSch,
          notes: postponeReason,
        });

        res.json(updatedSch);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal merevisi jadwal.' });
      }
    }
  );

  // ==========================================================================
  // PERSONNEL, COMPETENCIES & HYBRID AVAILABILITY ENGINE
  // ==========================================================================
  router.get('/personnel', async (_req, res) => {
    try {
      const [pers, pComps, comps, certs, depts] = await Promise.all([
        db.select().from(personnel).orderBy(personnel.code),
        db.select().from(personnelCompetencies),
        db.select().from(competencies),
        db.select().from(certifications),
        db.select().from(departments),
      ]);

      const enriched = pers.map((p) => {
        const compLinks = pComps
          .filter((pc) => pc.personnelId === p.id)
          .map((pc) => ({
            ...pc,
            competency: comps.find((c) => c.id === pc.competencyId) || null,
          }));
        const personCerts = certs.filter((c) => c.personnelId === p.id);
        const dept = depts.find((d) => d.id === p.departmentId) || null;
        return {
          ...p,
          department: dept,
          competencies: compLinks,
          certifications: personCerts,
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error('Error in GET /api/personnel:', error);
      res.status(500).json({ error: 'Gagal memuat data personel.' });
    }
  });

  router.post(
    '/personnel',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          code: z.string().min(2),
          category: z.enum(['INTERNAL', 'EXTERNAL']),
          fullName: z.string().min(2),
          departmentId: z.string().uuid().optional().nullable(),
          position: z.string().min(2),
          phone: z.string().min(3),
          email: z.string().optional().default(''),
          baseLocation: z.string().min(2),
          employmentStatus: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED']).default('ACTIVE'),
          fieldEligible: z.boolean().default(false),
          notes: z.string().optional().default(''),
          competencyIds: z.array(z.string().uuid()).optional().default([]),
        });
        const parsed = schema.parse(req.body);

        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(personnel)
            .values({
              code: parsed.code,
              category: parsed.category,
              fullName: parsed.fullName,
              departmentId: parsed.departmentId || null,
              position: parsed.position,
              phone: parsed.phone,
              email: parsed.email,
              baseLocation: parsed.baseLocation,
              employmentStatus: parsed.employmentStatus,
              fieldEligible: parsed.category === 'INTERNAL' ? parsed.fieldEligible : parsed.fieldEligible,
              verifiedBy: parsed.fieldEligible ? req.appUser!.id : null,
              verifiedAt: parsed.fieldEligible ? new Date() : null,
              notes: parsed.notes,
            })
            .returning();

          if (parsed.competencyIds.length > 0) {
            await tx.insert(personnelCompetencies).values(
              parsed.competencyIds.map((cid) => ({
                personnelId: row.id,
                competencyId: cid,
                verified: true,
                level: 'SENIOR',
              }))
            );
          }
          return row;
        });

        await writeAudit({
          user: req.appUser,
          action: 'CREATE_PERSONNEL',
          entityType: 'PERSONNEL',
          entityId: created.id,
          entityNumber: created.code,
          afterState: created,
        });

        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menambah personel.' });
      }
    }
  );

  router.post(
    '/personnel/:id/verify',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({ fieldEligible: z.boolean() });
        const { fieldEligible } = schema.parse(req.body);
        const personnelId = String(req.params.id);

        const [updated] = await db
          .update(personnel)
          .set({
            fieldEligible,
            verifiedBy: req.appUser!.id,
            verifiedAt: new Date(),
          })
          .where(eq(personnel.id, personnelId))
          .returning();

        if (!updated) return res.status(404).json({ error: 'Personel tidak ditemukan.' });

        await writeAudit({
          user: req.appUser,
          action: fieldEligible ? 'VERIFY_PERSONNEL_ELIGIBLE' : 'REVOKE_PERSONNEL_ELIGIBLE',
          entityType: 'PERSONNEL',
          entityId: updated.id,
          entityNumber: updated.code,
          afterState: { fieldEligible },
        });

        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memverifikasi personel.' });
      }
    }
  );

  router.get('/availability', async (req: Request, res) => {
    try {
      const startParam = typeof req.query.start === 'string' ? req.query.start : new Date().toISOString();
      const endParam =
        typeof req.query.end === 'string'
          ? req.query.end
          : new Date(Date.now() + 8 * 3600 * 1000).toISOString();

      const targetStart = new Date(startParam);
      const targetEnd = new Date(endParam);

      const [pers, pComps, assigns, leaves, manuals, reqs, schedules] = await Promise.all([
        db.select().from(personnel).orderBy(personnel.code),
        db.select().from(personnelCompetencies),
        db.select().from(personnelAssignments),
        db.select().from(leaveRequests),
        db.select().from(availabilityRecords),
        db.select().from(samplingRequests),
        db.select().from(samplingSchedules),
      ]);

      const reqMap = new Map(reqs.map((r) => [r.id, r]));
      const schMap = new Map(schedules.map((s) => [s.id, s]));

      const assignmentWindows: AssignmentWindow[] = assigns.map((a) => {
        const sch = schMap.get(a.scheduleId);
        const r = reqMap.get(a.requestId);
        return {
          id: a.id,
          requestId: a.requestId,
          scheduleId: a.scheduleId,
          personnelId: a.personnelId,
          assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
          startDate: a.startDate,
          endDate: a.endDate,
          mobilizationBufferHours: sch?.mobilizationBufferHours ?? 2,
          returnBufferHours: sch?.returnBufferHours ?? 2,
          jobName: r?.jobName || sch?.activityName,
        };
      });

      const leaveWindows: LeaveWindow[] = leaves.map((l) => ({
        id: l.id,
        personnelId: l.personnelId,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status as LeaveWindow['status'],
        leaveType: l.leaveType,
        reason: l.reason || '',
      }));

      const manualWindows: ManualAvailabilityWindow[] = manuals.map((m) => ({
        id: m.id,
        personnelId: m.personnelId,
        startDate: m.startDate,
        endDate: m.endDate,
        status: m.status as ManualAvailabilityWindow['status'],
        source: m.source as ManualAvailabilityWindow['source'],
        reason: m.reason || '',
      }));

      const results = pers.map((p) => {
        const profile: PersonnelProfile = {
          id: p.id,
          code: p.code,
          fullName: p.fullName,
          category: p.category as 'INTERNAL' | 'EXTERNAL',
          departmentId: p.departmentId,
          baseLocation: p.baseLocation,
          employmentStatus: p.employmentStatus as PersonnelProfile['employmentStatus'],
          fieldEligible: p.fieldEligible,
          competencyIds: pComps.filter((pc) => pc.personnelId === p.id).map((pc) => pc.competencyId),
        };
        const evaluation = evaluatePersonnelAvailability({
          person: profile,
          targetStart,
          targetEnd,
          assignments: assignmentWindows,
          leaves: leaveWindows,
          manualRecords: manualWindows,
        });
        return {
          personnel: p,
          evaluation,
        };
      });

      res.json({
        targetStart,
        targetEnd,
        personnelAvailability: results,
        manualRecords: manuals,
        leaveRequests: leaves,
      });
    } catch (error) {
      console.error('Error in GET /api/availability:', error);
      res.status(500).json({ error: 'Gagal menghitung ketersediaan personel.' });
    }
  });

  router.post(
    '/availability/manual',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          personnelId: z.string().uuid(),
          startDate: z.string().min(4),
          endDate: z.string().min(4),
          status: z.enum(['AVAILABLE', 'UNAVAILABLE', 'TENTATIVE', 'ON_LEAVE']),
          reason: z.string().min(2),
        });
        const parsed = schema.parse(req.body);
        const targetStart = new Date(parsed.startDate);
        const targetEnd = new Date(parsed.endDate);

        const [person] = await db
          .select()
          .from(personnel)
          .where(eq(personnel.id, parsed.personnelId))
          .limit(1);
        if (!person) return res.status(404).json({ error: 'Personel tidak ditemukan.' });

        const [pComps, assigns, leaves, manuals] = await Promise.all([
          db.select().from(personnelCompetencies).where(eq(personnelCompetencies.personnelId, person.id)),
          db.select().from(personnelAssignments).where(eq(personnelAssignments.personnelId, person.id)),
          db.select().from(leaveRequests).where(eq(leaveRequests.personnelId, person.id)),
          db.select().from(availabilityRecords).where(eq(availabilityRecords.personnelId, person.id)),
        ]);

        const evalCheck = evaluatePersonnelAvailability({
          person: {
            id: person.id,
            code: person.code,
            fullName: person.fullName,
            category: person.category as 'INTERNAL' | 'EXTERNAL',
            baseLocation: person.baseLocation,
            employmentStatus: person.employmentStatus as PersonnelProfile['employmentStatus'],
            fieldEligible: person.fieldEligible,
            competencyIds: pComps.map((pc) => pc.competencyId),
          },
          targetStart,
          targetEnd,
          assignments: assigns.map((a) => ({
            id: a.id,
            requestId: a.requestId,
            scheduleId: a.scheduleId,
            personnelId: a.personnelId,
            assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
            startDate: a.startDate,
            endDate: a.endDate,
          })),
          leaves: leaves.map((l) => ({
            id: l.id,
            personnelId: l.personnelId,
            startDate: l.startDate,
            endDate: l.endDate,
            status: l.status as LeaveWindow['status'],
            leaveType: l.leaveType,
          })),
          manualRecords: manuals.map((m) => ({
            id: m.id,
            personnelId: m.personnelId,
            startDate: m.startDate,
            endDate: m.endDate,
            status: m.status as ManualAvailabilityWindow['status'],
            source: m.source as ManualAvailabilityWindow['source'],
          })),
        });

        if (parsed.status === 'AVAILABLE') {
          const overrideCheck = canManualOverrideStatus(evalCheck);
          if (!overrideCheck.allowed) {
            return res.status(409).json({ error: overrideCheck.reason });
          }
        }

        const [created] = await db
          .insert(availabilityRecords)
          .values({
            personnelId: parsed.personnelId,
            startDate: targetStart,
            endDate: targetEnd,
            status: parsed.status,
            source: 'MANUAL',
            reason: parsed.reason,
            confirmedBy: req.appUser!.id,
          })
          .returning();

        await writeAudit({
          user: req.appUser,
          action: 'MANUAL_AVAILABILITY_CONFIRMATION',
          entityType: 'AVAILABILITY',
          entityId: created.id,
          entityNumber: person.code,
          afterState: created,
        });

        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menyimpan konfirmasi ketersediaan.' });
      }
    }
  );

  router.post(
    '/leaves',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          personnelId: z.string().uuid(),
          leaveType: z.enum(['ANNUAL', 'SICK', 'TRAINING', 'OTHER']),
          startDate: z.string().min(4),
          endDate: z.string().min(4),
          reason: z.string().default(''),
        });
        const parsed = schema.parse(req.body);
        const [created] = await db
          .insert(leaveRequests)
          .values({
            personnelId: parsed.personnelId,
            leaveType: parsed.leaveType,
            startDate: new Date(parsed.startDate),
            endDate: new Date(parsed.endDate),
            status: 'APPROVED',
            reason: parsed.reason,
            approvedBy: req.appUser!.id,
          })
          .returning();

        await writeAudit({
          user: req.appUser,
          action: 'RECORD_PERSONNEL_LEAVE',
          entityType: 'LEAVE',
          entityId: created.id,
          afterState: created,
        });

        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal mencatat cuti.' });
      }
    }
  );

  // ==========================================================================
  // SCHEDULING, AUTOMATIC RECOMMENDATIONS & ASSIGNMENTS
  // ==========================================================================
  router.get('/assignments', async (_req, res) => {
    try {
      const [assigns, pers, reqs, schs] = await Promise.all([
        db.select().from(personnelAssignments).orderBy(desc(personnelAssignments.createdAt)),
        db.select().from(personnel),
        db.select().from(samplingRequests),
        db.select().from(samplingSchedules),
      ]);
      const pMap = new Map(pers.map((p) => [p.id, p]));
      const rMap = new Map(reqs.map((r) => [r.id, r]));
      const sMap = new Map(schs.map((s) => [s.id, s]));

      res.json(
        assigns.map((a) => ({
          ...a,
          personnel: pMap.get(a.personnelId) || null,
          request: rMap.get(a.requestId) || null,
          schedule: sMap.get(a.scheduleId) || null,
        }))
      );
    } catch (error) {
      console.error('Error in GET /api/assignments:', error);
      res.status(500).json({ error: 'Gagal memuat data penugasan.' });
    }
  });

  router.get(
    '/assignments/recommendations/:requestId',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const requestId = String(req.params.requestId);
        const [reqRow] = await db
          .select()
          .from(samplingRequests)
          .where(eq(samplingRequests.id, requestId))
          .limit(1);
        if (!reqRow) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });

        const [reqMats, allMats, pers, pComps, assigns, leaves, manuals, schedules] =
          await Promise.all([
            db.select().from(requestMatrices).where(eq(requestMatrices.requestId, requestId)),
            db.select().from(matrices),
            db.select().from(personnel),
            db.select().from(personnelCompetencies),
            db.select().from(personnelAssignments),
            db.select().from(leaveRequests),
            db.select().from(availabilityRecords),
            db
              .select()
              .from(samplingSchedules)
              .where(and(eq(samplingSchedules.requestId, requestId), eq(samplingSchedules.isActive, true))),
          ]);

        const activeSch = schedules[0];
        const targetStart = activeSch ? activeSch.startDate : reqRow.proposedDate;
        const targetEnd = activeSch
          ? activeSch.endDate
          : reqRow.proposedEndDate && reqRow.proposedEndDate.getTime() > reqRow.proposedDate.getTime()
          ? reqRow.proposedEndDate
          : new Date(reqRow.proposedDate.getTime() + (reqRow.estimatedDurationHours || 8) * 3600000);

        const requiredCompIds = new Set<string>();
        for (const rm of reqMats) {
          const masterMat =
            allMats.find((m) => m.id === rm.matrixId) ||
            allMats.find((m) =>
              rm.matrixName.toLowerCase().includes(m.category.toLowerCase())
            );
          if (masterMat?.requiredCompetencyId) {
            requiredCompIds.add(masterMat.requiredCompetencyId);
          }
        }

        const ranked = recommendPersonnel({
          allPersonnel: pers.map((p) => ({
            id: p.id,
            code: p.code,
            fullName: p.fullName,
            category: p.category as 'INTERNAL' | 'EXTERNAL',
            departmentId: p.departmentId,
            baseLocation: p.baseLocation,
            employmentStatus: p.employmentStatus as PersonnelProfile['employmentStatus'],
            fieldEligible: p.fieldEligible,
            competencyIds: pComps.filter((pc) => pc.personnelId === p.id).map((pc) => pc.competencyId),
          })),
          assignments: assigns.map((a) => ({
            id: a.id,
            requestId: a.requestId,
            scheduleId: a.scheduleId,
            personnelId: a.personnelId,
            assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
            startDate: a.startDate,
            endDate: a.endDate,
          })),
          leaves: leaves.map((l) => ({
            id: l.id,
            personnelId: l.personnelId,
            startDate: l.startDate,
            endDate: l.endDate,
            status: l.status as LeaveWindow['status'],
            leaveType: l.leaveType,
            reason: l.reason || '',
          })),
          manualRecords: manuals.map((m) => ({
            id: m.id,
            personnelId: m.personnelId,
            startDate: m.startDate,
            endDate: m.endDate,
            status: m.status as ManualAvailabilityWindow['status'],
            source: m.source as ManualAvailabilityWindow['source'],
            reason: m.reason || '',
          })),
          targetStart,
          targetEnd,
          requiredCompetencyIds: Array.from(requiredCompIds),
          targetLocation: reqRow.samplingLocation,
          excludeScheduleId: activeSch?.id,
        });

        res.json({
          requestId,
          scheduleId: activeSch?.id || null,
          targetStart,
          targetEnd,
          requiredCompetencyIds: Array.from(requiredCompIds),
          recommendations: ranked,
        });
      } catch (error) {
        console.error('Error in GET /api/assignments/recommendations/:requestId:', error);
        res.status(500).json({ error: 'Gagal menghitung rekomendasi personel.' });
      }
    }
  );

  router.post(
    '/assignments',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          requestId: z.string().uuid(),
          startDate: z.string().min(4),
          endDate: z.string().min(4),
          assignmentStatus: z.enum(['CONFIRMED', 'TENTATIVE']).default('CONFIRMED'),
          assignmentMode: z.enum(['MANUAL', 'AUTO_RECOMMENDED']).default('MANUAL'),
          notes: z.string().optional().default(''),
          members: z
            .array(
              z.object({
                personnelId: z.string().uuid(),
                roleInTeam: z.enum(['TEAM_LEADER', 'MEMBER', 'DRIVER']),
              })
            )
            .min(1),
        });
        const parsed = schema.parse(req.body);
        const startDate = new Date(parsed.startDate);
        const endDate = new Date(parsed.endDate);
        if (endDate.getTime() <= startDate.getTime()) {
          return res.status(400).json({ error: 'Waktu selesai penugasan harus setelah waktu mulai.' });
        }

        const result = await db.transaction(async (tx) => {
          const [reqRow] = await tx
            .select()
            .from(samplingRequests)
            .where(eq(samplingRequests.id, parsed.requestId))
            .limit(1);
          if (!reqRow) throw new Error('Permintaan sampling tidak ditemukan.');

          let [activeSch] = await tx
            .select()
            .from(samplingSchedules)
            .where(
              and(eq(samplingSchedules.requestId, parsed.requestId), eq(samplingSchedules.isActive, true))
            )
            .limit(1);

          if (!activeSch) {
            [activeSch] = await tx
              .insert(samplingSchedules)
              .values({
                requestId: parsed.requestId,
                scheduleCode: `SCH-${reqRow.requestNumber.replaceAll('/', '-')}`,
                activityName: reqRow.jobName,
                startDate,
                endDate,
                mobilizationBufferHours: reqRow.mobilizationHours ?? 2,
                returnBufferHours: 2,
                revisionNumber: 1,
                isActive: true,
              })
              .returning();
          } else {
            [activeSch] = await tx
              .update(samplingSchedules)
              .set({ startDate, endDate })
              .where(eq(samplingSchedules.id, activeSch.id))
              .returning();
          }

          const allPers = await tx.select().from(personnel);
          const allAssigns = await tx.select().from(personnelAssignments);
          const allLeaves = await tx.select().from(leaveRequests);
          const allManuals = await tx.select().from(availabilityRecords);

          // Server-side conflict & eligibility validation for every member
          for (const member of parsed.members) {
            const p = allPers.find((x) => x.id === member.personnelId);
            if (!p) throw new Error('Data personel tidak ditemukan.');

            const evalResult = evaluatePersonnelAvailability({
              person: {
                id: p.id,
                code: p.code,
                fullName: p.fullName,
                category: p.category as 'INTERNAL' | 'EXTERNAL',
                baseLocation: p.baseLocation,
                employmentStatus: p.employmentStatus as PersonnelProfile['employmentStatus'],
                fieldEligible: p.fieldEligible,
                competencyIds: [],
              },
              targetStart: startDate,
              targetEnd: endDate,
              mobilizationBufferHours: activeSch.mobilizationBufferHours,
              returnBufferHours: activeSch.returnBufferHours,
              assignments: allAssigns.map((a) => ({
                id: a.id,
                requestId: a.requestId,
                scheduleId: a.scheduleId,
                personnelId: a.personnelId,
                assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
                startDate: a.startDate,
                endDate: a.endDate,
              })),
              leaves: allLeaves.map((l) => ({
                id: l.id,
                personnelId: l.personnelId,
                startDate: l.startDate,
                endDate: l.endDate,
                status: l.status as LeaveWindow['status'],
                leaveType: l.leaveType,
                reason: l.reason || '',
              })),
              manualRecords: allManuals.map((m) => ({
                id: m.id,
                personnelId: m.personnelId,
                startDate: m.startDate,
                endDate: m.endDate,
                status: m.status as ManualAvailabilityWindow['status'],
                source: m.source as ManualAvailabilityWindow['source'],
                reason: m.reason || '',
              })),
              excludeScheduleId: activeSch.id,
            });

            if (parsed.assignmentStatus === 'CONFIRMED' && evalResult.hasConfirmedConflict) {
              throw new Error(`${p.fullName} tidak dapat ditugaskan: ${evalResult.reasons.join('; ')}`);
            }
          }

          // Clear non-replaced assignments for this schedule before re-inserting updated team
          await tx
            .delete(personnelAssignments)
            .where(eq(personnelAssignments.scheduleId, activeSch.id));

          const insertedAssigns = await tx
            .insert(personnelAssignments)
            .values(
              parsed.members.map((m) => ({
                scheduleId: activeSch.id,
                requestId: parsed.requestId,
                personnelId: m.personnelId,
                roleInTeam: m.roleInTeam,
                assignmentStatus: parsed.assignmentStatus,
                assignmentMode: parsed.assignmentMode,
                startDate,
                endDate,
                notes: parsed.notes,
                assignedBy: req.appUser!.id,
              }))
            )
            .returning();

          await tx
            .update(samplingRequests)
            .set({
              status: parsed.assignmentStatus === 'CONFIRMED' ? 'SCHEDULED' : 'ASSIGNED',
              updatedAt: new Date(),
            })
            .where(eq(samplingRequests.id, parsed.requestId));

          return { reqRow, activeSch, insertedAssigns };
        });

        await createNotification({
          recipientRole: 'KAE_SALES',
          eventType: 'PERSONNEL_ASSIGNED',
          title: 'Penugasan Personel Dikonfirmasi',
          recordNumber: result.reqRow.requestNumber,
          description: `Tim sampling untuk ${result.reqRow.customerName} telah dijadwalkan oleh SPV Sampling.`,
          targetRoute: 'gantt',
          targetId: result.reqRow.id,
        });

        await writeAudit({
          user: req.appUser,
          action: 'CONFIRM_PERSONNEL_ASSIGNMENT',
          entityType: 'PERSONNEL_ASSIGNMENT',
          entityId: result.activeSch.id,
          entityNumber: result.reqRow.requestNumber,
          afterState: result.insertedAssigns,
          notes: parsed.notes,
        });

        res.status(201).json(result.insertedAssigns);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Gagal menyimpan penugasan personel.';
        const statusCode = msg.includes('tidak dapat ditugaskan') ? 409 : 400;
        res.status(statusCode).json({ error: msg });
      }
    }
  );

  router.post(
    '/assignments/:id/replace',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          newPersonnelId: z.string().uuid(),
          reason: z.string().min(2),
        });
        const { newPersonnelId, reason } = schema.parse(req.body);
        const assignmentId = String(req.params.id);

        const replaced = await db.transaction(async (tx) => {
          const [oldAssign] = await tx
            .select()
            .from(personnelAssignments)
            .where(eq(personnelAssignments.id, assignmentId))
            .limit(1);
          if (!oldAssign) throw new Error('Penugasan tidak ditemukan.');

          const [newPerson] = await tx
            .select()
            .from(personnel)
            .where(eq(personnel.id, newPersonnelId))
            .limit(1);
          if (!newPerson) throw new Error('Personel pengganti tidak ditemukan.');
          if (!newPerson.fieldEligible || newPerson.employmentStatus !== 'ACTIVE') {
            throw new Error(`${newPerson.fullName} belum terverifikasi layak tugas lapangan.`);
          }

          const allAssigns = await tx.select().from(personnelAssignments);
          const allLeaves = await tx.select().from(leaveRequests);
          const allManuals = await tx.select().from(availabilityRecords);

          const evalCheck = evaluatePersonnelAvailability({
            person: {
              id: newPerson.id,
              code: newPerson.code,
              fullName: newPerson.fullName,
              category: newPerson.category as 'INTERNAL' | 'EXTERNAL',
              baseLocation: newPerson.baseLocation,
              employmentStatus: newPerson.employmentStatus as PersonnelProfile['employmentStatus'],
              fieldEligible: newPerson.fieldEligible,
              competencyIds: [],
            },
            targetStart: oldAssign.startDate,
            targetEnd: oldAssign.endDate,
            assignments: allAssigns.map((a) => ({
              id: a.id,
              requestId: a.requestId,
              scheduleId: a.scheduleId,
              personnelId: a.personnelId,
              assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
              startDate: a.startDate,
              endDate: a.endDate,
            })),
            leaves: allLeaves.map((l) => ({
              id: l.id,
              personnelId: l.personnelId,
              startDate: l.startDate,
              endDate: l.endDate,
              status: l.status as LeaveWindow['status'],
              leaveType: l.leaveType,
            })),
            manualRecords: allManuals.map((m) => ({
              id: m.id,
              personnelId: m.personnelId,
              startDate: m.startDate,
              endDate: m.endDate,
              status: m.status as ManualAvailabilityWindow['status'],
              source: m.source as ManualAvailabilityWindow['source'],
            })),
            excludeScheduleId: oldAssign.scheduleId,
          });

          if (evalCheck.hasConfirmedConflict) {
            throw new Error(`Pengganti bentrok: ${evalCheck.reasons.join('; ')}`);
          }

          await tx
            .update(personnelAssignments)
            .set({
              assignmentStatus: 'REPLACED',
              replacedByPersonnelId: newPersonnelId,
              notes: `${oldAssign.notes || ''} [Diganti: ${reason}]`.trim(),
            })
            .where(eq(personnelAssignments.id, assignmentId));

          const [createdNew] = await tx
            .insert(personnelAssignments)
            .values({
              scheduleId: oldAssign.scheduleId,
              requestId: oldAssign.requestId,
              personnelId: newPersonnelId,
              roleInTeam: oldAssign.roleInTeam,
              assignmentStatus: 'CONFIRMED',
              assignmentMode: 'MANUAL',
              startDate: oldAssign.startDate,
              endDate: oldAssign.endDate,
              notes: `Pengganti personel sebelumnya (${reason})`,
              assignedBy: req.appUser!.id,
            })
            .returning();

          return { oldAssign, createdNew, newPerson };
        });

        await createNotification({
          recipientRole: 'SPV_SAMPLING',
          eventType: 'PERSONNEL_REPLACED',
          title: 'Penggantian Personel Lapangan',
          recordNumber: replaced.newPerson.code,
          description: `Personel diganti ke ${replaced.newPerson.fullName}. Alasan: ${reason}`,
          targetRoute: 'gantt',
          targetId: replaced.oldAssign.requestId,
        });

        await writeAudit({
          user: req.appUser,
          action: 'REPLACE_ASSIGNED_PERSONNEL',
          entityType: 'PERSONNEL_ASSIGNMENT',
          entityId: replaced.createdNew.id,
          beforeState: replaced.oldAssign,
          afterState: replaced.createdNew,
          notes: reason,
        });

        res.json(replaced.createdNew);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Gagal mengganti personel.';
        res.status(msg.includes('bentrok') ? 409 : 400).json({ error: msg });
      }
    }
  );

  // ==========================================================================
  // VEHICLES & RESERVATIONS
  // ==========================================================================
  router.get('/vehicles', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (_req, res) => {
    try {
      const [allVehs, allRes, allReqs, allPers] = await Promise.all([
        db.select().from(vehicles).orderBy(vehicles.vehicleCode),
        db.select().from(vehicleReservations).orderBy(desc(vehicleReservations.departureTime)),
        db.select().from(samplingRequests),
        db.select().from(personnel),
      ]);
      const rMap = new Map(allReqs.map((r) => [r.id, r]));
      const pMap = new Map(allPers.map((p) => [p.id, p]));

      res.json({
        vehicles: allVehs,
        reservations: allRes.map((r) => ({
          ...r,
          vehicle: allVehs.find((v) => v.id === r.vehicleId) || null,
          request: rMap.get(r.requestId) || null,
          driver: r.driverPersonnelId ? pMap.get(r.driverPersonnelId) || null : null,
        })),
      });
    } catch (error) {
      console.error('Error in GET /api/vehicles:', error);
      res.status(500).json({ error: 'Gagal memuat data kendaraan.' });
    }
  });

  router.post(
    '/vehicles',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          vehicleCode: z.string().min(2),
          registrationNumber: z.string().min(3),
          model: z.string().min(2),
          vehicleType: z.string().min(2),
          passengerCapacity: z.number().int().min(1).max(20),
          operationalStatus: z.enum(['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'UNAVAILABLE']).default('AVAILABLE'),
          baseLocation: z.string().min(2),
          notes: z.string().optional().default(''),
        });
        const parsed = schema.parse(req.body);
        const [created] = await db.insert(vehicles).values(parsed).returning();
        await writeAudit({
          user: req.appUser,
          action: 'CREATE_VEHICLE',
          entityType: 'VEHICLE',
          entityId: created.id,
          entityNumber: created.registrationNumber,
          afterState: created,
        });
        res.status(201).json(created);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menambah kendaraan.' });
      }
    }
  );

  router.patch(
    '/vehicles/:id/status',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          operationalStatus: z.enum(['AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'UNAVAILABLE']),
          notes: z.string().optional(),
        });
        const parsed = schema.parse(req.body);
        const [updated] = await db
          .update(vehicles)
          .set({
            operationalStatus: parsed.operationalStatus,
            ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
          })
          .where(eq(vehicles.id, String(req.params.id)))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Kendaraan tidak ditemukan.' });
        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memperbarui status kendaraan.' });
      }
    }
  );

  router.delete(
    '/vehicles/:id',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const vehicleId = String(req.params.id);
        const deleted = await db.transaction(async (tx) => {
          const [veh] = await tx
            .select()
            .from(vehicles)
            .where(eq(vehicles.id, vehicleId))
            .limit(1);
          if (!veh) throw new Error('Kendaraan tidak ditemukan.');

          const activeRes = await tx
            .select()
            .from(vehicleReservations)
            .where(
              and(
                eq(vehicleReservations.vehicleId, vehicleId),
                inArray(vehicleReservations.status, ['RESERVED', 'IN_USE'])
              )
            );
          if (activeRes.length > 0) {
            throw new Error(
              'Kendaraan tidak dapat dihapus karena masih memiliki reservasi aktif.'
            );
          }

          await tx
            .delete(vehicleReservations)
            .where(eq(vehicleReservations.vehicleId, vehicleId));

          const [removed] = await tx
            .delete(vehicles)
            .where(eq(vehicles.id, vehicleId))
            .returning();

          return removed;
        });

        await writeAudit({
          user: req.appUser,
          action: 'DELETE_VEHICLE',
          entityType: 'VEHICLE',
          entityId: deleted.id,
          entityNumber: deleted.registrationNumber,
          beforeState: deleted,
        });

        res.json({ ok: true, id: deleted.id });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Gagal menghapus kendaraan.';
        const status = msg.includes('reservasi aktif')
          ? 409
          : msg.includes('tidak ditemukan')
          ? 404
          : 400;
        res.status(status).json({ error: msg });
      }
    }
  );

  router.post(
    '/vehicle-reservations',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          vehicleId: z.string().uuid(),
          requestId: z.string().uuid(),
          driverPersonnelId: z.string().uuid().optional().nullable(),
          departureTime: z.string().min(4),
          returnTime: z.string().min(4),
          destination: z.string().min(2),
          passengerCount: z.number().int().min(1),
          notes: z.string().optional().default(''),
        });
        const parsed = schema.parse(req.body);
        const departureTime = new Date(parsed.departureTime);
        const returnTime = new Date(parsed.returnTime);

        const created = await db.transaction(async (tx) => {
          const [veh] = await tx
            .select()
            .from(vehicles)
            .where(eq(vehicles.id, parsed.vehicleId))
            .limit(1);
          if (!veh) throw new Error('Kendaraan tidak ditemukan.');

          const [sch] = await tx
            .select()
            .from(samplingSchedules)
            .where(
              and(eq(samplingSchedules.requestId, parsed.requestId), eq(samplingSchedules.isActive, true))
            )
            .limit(1);
          if (!sch) throw new Error('Jadwal aktif untuk permintaan ini belum tersedia.');

          const [existingRes, driverAssigns] = await Promise.all([
            tx.select().from(vehicleReservations).where(eq(vehicleReservations.vehicleId, veh.id)),
            parsed.driverPersonnelId
              ? tx
                  .select()
                  .from(personnelAssignments)
                  .where(eq(personnelAssignments.personnelId, parsed.driverPersonnelId))
              : Promise.resolve([]),
          ]);

          const check = validateVehicleReservation({
            vehicle: {
              id: veh.id,
              vehicleCode: veh.vehicleCode,
              registrationNumber: veh.registrationNumber,
              model: veh.model,
              passengerCapacity: veh.passengerCapacity,
              operationalStatus: veh.operationalStatus as 'AVAILABLE' | 'ASSIGNED' | 'MAINTENANCE' | 'UNAVAILABLE',
              baseLocation: veh.baseLocation,
            },
            existingReservations: existingRes.map((r) => ({
              id: r.id,
              vehicleId: r.vehicleId,
              scheduleId: r.scheduleId,
              driverPersonnelId: r.driverPersonnelId,
              departureTime: r.departureTime,
              returnTime: r.returnTime,
              status: r.status as 'RESERVED' | 'IN_USE' | 'COMPLETED' | 'CANCELLED',
              destination: r.destination,
            })),
            driverAssignments: driverAssigns.map((a) => ({
              id: a.id,
              requestId: a.requestId,
              scheduleId: a.scheduleId,
              personnelId: a.personnelId,
              assignmentStatus: a.assignmentStatus as AssignmentWindow['assignmentStatus'],
              startDate: a.startDate,
              endDate: a.endDate,
            })),
            departureTime,
            returnTime,
            passengerCount: parsed.passengerCount,
            driverPersonnelId: parsed.driverPersonnelId,
            excludeScheduleId: sch.id,
          });

          if (!check.valid) {
            throw new Error(check.errors.join(' | '));
          }

          const [resRow] = await tx
            .insert(vehicleReservations)
            .values({
              vehicleId: veh.id,
              scheduleId: sch.id,
              requestId: parsed.requestId,
              driverPersonnelId: parsed.driverPersonnelId || null,
              departureTime,
              returnTime,
              destination: parsed.destination,
              passengerCount: parsed.passengerCount,
              status: 'RESERVED',
              notes: parsed.notes,
              reservedBy: req.appUser!.id,
            })
            .returning();

          return { resRow, veh };
        });

        await createNotification({
          recipientRole: 'SPV_SAMPLING',
          eventType: 'VEHICLE_ASSIGNED',
          title: 'Reservasi Kendaraan Terkonfirmasi',
          recordNumber: created.veh.registrationNumber,
          description: `Kendaraan ${created.veh.model} dijadwalkan menuju ${parsed.destination}.`,
          targetRoute: 'vehicles',
          targetId: created.resRow.id,
        });

        await writeAudit({
          user: req.appUser,
          action: 'RESERVE_VEHICLE',
          entityType: 'VEHICLE_RESERVATION',
          entityId: created.resRow.id,
          entityNumber: created.veh.registrationNumber,
          afterState: created.resRow,
        });

        res.status(201).json(created.resRow);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Gagal mereservasi kendaraan.';
        const status =
          msg.includes('sudah direservasi') ||
          msg.includes('Kapasitas') ||
          msg.includes('Pengemudi')
            ? 409
            : 400;
        res.status(status).json({ error: msg });
      }
    }
  );

  // ==========================================================================
  // JOBS & EXECUTION STATUS
  // ==========================================================================
  router.post(
    '/jobs/:requestId/status',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
          notes: z.string().optional().default(''),
        });
        const { status, notes } = schema.parse(req.body);
        const requestId = String(req.params.requestId);

        const [updated] = await db
          .update(samplingRequests)
          .set({ status, updatedAt: new Date() })
          .where(eq(samplingRequests.id, requestId))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Pekerjaan tidak ditemukan.' });

        await writeAudit({
          user: req.appUser,
          action: `UPDATE_JOB_STATUS_${status}`,
          entityType: 'SAMPLING_REQUEST',
          entityId: updated.id,
          entityNumber: updated.requestNumber,
          afterState: { status },
          notes,
        });

        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memperbarui status pekerjaan.' });
      }
    }
  );

  // ==========================================================================
  // SPS GENERATION, REVISION, PDF & ARCHIVAL LIFECYCLE
  // ==========================================================================
  router.get('/sps', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (_req, res) => {
    try {
      const [docs, schedules, revisions, events] = await Promise.all([
        db.select().from(spsDocuments).orderBy(desc(spsDocuments.createdAt)),
        db.select().from(samplingSchedules),
        db.select().from(spsRevisions).orderBy(desc(spsRevisions.revisionNumber)),
        db.select().from(documentEvents).orderBy(desc(documentEvents.createdAt)),
      ]);

      const now = new Date();
      const enriched = docs.map((doc) => {
        const latestSch = schedules
          .filter((s) => s.requestId === doc.requestId && s.isActive)
          .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];

        const lifecycleEval = evaluateSpsArchivalLifecycle({
          spsNumber: doc.spsNumber,
          lifecycleStatus: doc.lifecycleStatus,
          originalEndDate: doc.samplingEndDate,
          latestApprovedScheduleEndDate: latestSch?.endDate ?? doc.samplingEndDate,
          archivalDeferredUntil: doc.archivalDeferredUntil,
          now,
        });

        return {
          ...doc,
          latestSchedule: latestSch || null,
          archivalEvaluation: lifecycleEval,
          revisions: revisions.filter((r) => r.spsDocumentId === doc.id),
          events: events.filter((e) => e.spsDocumentId === doc.id),
        };
      });

      res.json(enriched);
    } catch (error) {
      console.error('Error in GET /api/sps:', error);
      res.status(500).json({ error: 'Gagal memuat dokumen SPS.' });
    }
  });

  router.post(
    '/sps/generate',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          requestId: z.string().uuid(),
          notes: z.string().optional().default(''),
          createTemplate: z.boolean().optional().default(false),
          templateName: z.string().optional(),
        });
        const parsed = schema.parse(req.body);

        const generated = await db.transaction(async (tx) => {
          const [reqRow] = await tx
            .select()
            .from(samplingRequests)
            .where(eq(samplingRequests.id, parsed.requestId))
            .limit(1);
          if (!reqRow) throw new Error('Permintaan sampling tidak ditemukan.');

          const existingForReq = await tx
            .select()
            .from(spsDocuments)
            .where(eq(spsDocuments.requestId, reqRow.id))
            .limit(1);
          if (existingForReq.length > 0) {
            throw new Error(`SPS untuk permintaan ini sudah dibuat (${existingForReq[0].spsNumber}).`);
          }

          const confirmedAssigns = await tx
            .select()
            .from(personnelAssignments)
            .where(
              and(
                eq(personnelAssignments.requestId, reqRow.id),
                eq(personnelAssignments.assignmentStatus, 'CONFIRMED')
              )
            );
          if (confirmedAssigns.length === 0) {
            throw new Error('SPS hanya dapat diterbitkan setelah penugasan personel terkonfirmasi.');
          }

          const allPers = await tx.select().from(personnel);
          const assignedNames = confirmedAssigns
            .map((a) => allPers.find((p) => p.id === a.personnelId)?.fullName)
            .filter((n): n is string => Boolean(n));

          const [activeSch] = await tx
            .select()
            .from(samplingSchedules)
            .where(
              and(eq(samplingSchedules.requestId, reqRow.id), eq(samplingSchedules.isActive, true))
            )
            .limit(1);

          const [numSetting] = await tx
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, 'sps_number_format'))
            .limit(1);

          const settingVal = (numSetting?.value as { pattern?: string; nextSequence?: number }) || {};
          const pattern = settingVal.pattern || '{SEQ}/SPS/AKL/{ROMAN_MONTH}/{YEAR}';
          let seq = settingVal.nextSequence || 31;

          // Guarantee unique SPS number
          let spsNumber = formatSpsNumber(pattern, seq, new Date());
          while (
            (await tx.select().from(spsDocuments).where(eq(spsDocuments.spsNumber, spsNumber))).length > 0
          ) {
            seq++;
            spsNumber = formatSpsNumber(pattern, seq, new Date());
          }

          await tx
            .update(systemSettings)
            .set({ value: { pattern, nextSequence: seq + 1 }, updatedAt: new Date() })
            .where(eq(systemSettings.key, 'sps_number_format'));

          const mats = await tx
            .select()
            .from(requestMatrices)
            .where(eq(requestMatrices.requestId, reqRow.id))
            .orderBy(requestMatrices.sortOrder);
          const matIds = mats.map((m) => m.id);
          const matParams =
            matIds.length > 0
              ? await tx
                  .select()
                  .from(requestMatrixParameters)
                  .where(inArray(requestMatrixParameters.requestMatrixId, matIds))
              : [];

          const start = activeSch?.startDate || reqRow.proposedDate;
          const end =
            activeSch?.endDate ||
            (reqRow.proposedEndDate && reqRow.proposedEndDate.getTime() > start.getTime()
              ? reqRow.proposedEndDate
              : new Date(reqRow.proposedDate.getTime() + (reqRow.estimatedDurationHours || 8) * 3600000));
          const dateLabel = formatSamplingDateRangeLabel(start, end);

          const matrixRows = mats.map((m, idx) => {
            const ps = matParams.filter((p) => p.requestMatrixId === m.id);
            const regularParams = ps.filter((p) => !p.isSubcontracted).map((p) => p.parameterName).join(', ');
            const subParams = ps.filter((p) => p.isSubcontracted).map((p) => p.parameterName).join(', ');
            return {
              no: idx + 1,
              dateLabel,
              matrixName: m.matrixName,
              pointCount: m.pointCount,
              pointLocations: m.pointDescription,
              parameters: regularParams || '-',
              subcontractedParameters: subParams,
              regulation: m.regulationName,
            };
          });

          const [createdSps] = await tx
            .insert(spsDocuments)
            .values({
              spsNumber,
              requestId: reqRow.id,
              scheduleId: activeSch?.id || null,
              customerName: reqRow.customerName,
              customerAddress: reqRow.customerAddress,
              customerPhone: reqRow.customerPhone || '-',
              customerPic: reqRow.customerPic,
              picPhone: reqRow.picPhone,
              jobName: reqRow.jobName,
              lhpNumber: reqRow.lhpNumber || '',
              contractNumber: reqRow.contractNumber || '-',
              samplingDateLabel: dateLabel,
              samplingStartDate: start,
              samplingEndDate: end,
              samplingLocation: reqRow.samplingLocation,
              assignedPersonnelNames: assignedNames,
              scheduleRows: [
                {
                  dateLabel,
                  activity: reqRow.jobName,
                  notes: activeSch?.notes || '-',
                },
              ],
              matrixRows,
              notes: parsed.notes || reqRow.specialInstructions || '-',
              preparedByName: req.appUser!.fullName,
              revisionNumber: 1,
              lifecycleStatus: 'ACTIVE',
              createdBy: req.appUser!.id,
            })
            .returning();

          await tx.insert(spsRevisions).values({
            spsDocumentId: createdSps.id,
            revisionNumber: 1,
            snapshotData: createdSps,
            changeReason: 'Penerbitan Dokumen SPS Resmi',
            revisedBy: req.appUser!.id,
            revisedByName: req.appUser!.fullName,
          });

          await tx.insert(documentEvents).values({
            spsDocumentId: createdSps.id,
            eventType: 'GENERATED',
            actorId: req.appUser!.id,
            actorName: req.appUser!.fullName,
            details: { spsNumber, requestNumber: reqRow.requestNumber },
          });

          if (parsed.createTemplate) {
            await tx.insert(spsTemplates).values({
              templateName: parsed.templateName || `${reqRow.customerName} — ${reqRow.jobName}`,
              sourceSpsId: createdSps.id,
              originalSpsNumber: spsNumber,
              customerName: reqRow.customerName,
              customerAddress: reqRow.customerAddress,
              customerPic: reqRow.customerPic,
              picPhone: reqRow.picPhone,
              jobName: reqRow.jobName,
              samplingLocation: reqRow.samplingLocation,
              activityDescription: reqRow.jobDescription || reqRow.jobName,
              defaultNotes: parsed.notes || reqRow.specialInstructions || '',
              matrixConfig: matrixRows,
              createdBy: req.appUser!.id,
            });
          }

          return { createdSps, reqRow };
        });

        await createNotification({
          recipientRole: 'KAE_SALES',
          eventType: 'SPS_GENERATED',
          title: 'Dokumen SPS Diterbitkan',
          recordNumber: generated.createdSps.spsNumber,
          description: `SPS ${generated.createdSps.spsNumber} untuk ${generated.createdSps.customerName} siap diunduh.`,
          targetRoute: 'sps',
          targetId: generated.createdSps.id,
        });

        await writeAudit({
          user: req.appUser,
          action: 'GENERATE_SPS_DOCUMENT',
          entityType: 'SPS_DOCUMENT',
          entityId: generated.createdSps.id,
          entityNumber: generated.createdSps.spsNumber,
          afterState: generated.createdSps,
        });

        res.status(201).json(generated.createdSps);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menerbitkan SPS.' });
      }
    }
  );

  router.post(
    '/sps/:id/revise',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          notes: z.string().optional(),
          samplingDateLabel: z.string().optional(),
          changeReason: z.string().min(2),
        });
        const parsed = schema.parse(req.body);
        const spsId = String(req.params.id);

        const [existing] = await db
          .select()
          .from(spsDocuments)
          .where(eq(spsDocuments.id, spsId))
          .limit(1);
        if (!existing) return res.status(404).json({ error: 'SPS tidak ditemukan.' });
        if (existing.isHistoricalImport && existing.lifecycleStatus === 'ARCHIVED') {
          return res.status(403).json({ error: 'SPS historis yang telah diarsipkan bersifat immutable.' });
        }

        const nextRev = existing.revisionNumber + 1;
        const [updated] = await db
          .update(spsDocuments)
          .set({
            notes: parsed.notes ?? existing.notes,
            samplingDateLabel: parsed.samplingDateLabel ?? existing.samplingDateLabel,
            revisionNumber: nextRev,
            updatedAt: new Date(),
          })
          .where(eq(spsDocuments.id, spsId))
          .returning();

        await db.insert(spsRevisions).values({
          spsDocumentId: spsId,
          revisionNumber: nextRev,
          snapshotData: updated,
          changeReason: parsed.changeReason,
          revisedBy: req.appUser!.id,
          revisedByName: req.appUser!.fullName,
        });

        await db.insert(documentEvents).values({
          spsDocumentId: spsId,
          eventType: 'REVISED',
          actorId: req.appUser!.id,
          actorName: req.appUser!.fullName,
          details: { revisionNumber: nextRev, reason: parsed.changeReason },
        });

        await writeAudit({
          user: req.appUser,
          action: 'REVISE_SPS_DOCUMENT',
          entityType: 'SPS_DOCUMENT',
          entityId: spsId,
          entityNumber: existing.spsNumber,
          beforeState: existing,
          afterState: updated,
          notes: parsed.changeReason,
        });

        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal merevisi SPS.' });
      }
    }
  );

  router.post(
    '/sps/:id/archival-decision',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          decision: z.enum(['ARCHIVE', 'DEFER']),
          reason: z.string().optional().default(''),
        });
        const { decision, reason } = schema.parse(req.body);
        const spsId = String(req.params.id);

        const result = await db.transaction(async (tx) => {
          const [doc] = await tx
            .select()
            .from(spsDocuments)
            .where(eq(spsDocuments.id, spsId))
            .limit(1);
          if (!doc) throw new Error('Dokumen SPS tidak ditemukan.');

          const latestSch = (
            await tx
              .select()
              .from(samplingSchedules)
              .where(and(eq(samplingSchedules.requestId, doc.requestId || spsId), eq(samplingSchedules.isActive, true)))
              .orderBy(desc(samplingSchedules.revisionNumber))
          )[0];

          const effectiveEnd = latestSch?.endDate ?? doc.samplingEndDate;
          if (decision === 'ARCHIVE' && effectiveEnd && effectiveEnd.getTime() > Date.now()) {
            throw new Error('SPS tidak dapat diarsipkan sebelum jadwal aktivitas sampling berakhir.');
          }

          if (decision === 'ARCHIVE') {
            const [updated] = await tx
              .update(spsDocuments)
              .set({
                lifecycleStatus: 'ARCHIVED',
                archivedAt: new Date(),
                archivedBy: req.appUser!.id,
                updatedAt: new Date(),
              })
              .where(eq(spsDocuments.id, spsId))
              .returning();

            const samplingYear = (effectiveEnd || doc.documentDate).getFullYear();
            await tx.insert(documentArchives).values({
              spsDocumentId: doc.id,
              spsNumber: doc.spsNumber,
              customerName: doc.customerName,
              jobName: doc.jobName,
              samplingYear,
              matricesSummary: doc.matrixRows.map((m) => m.matrixName).join(', '),
              personnelSummary: doc.assignedPersonnelNames.join(', '),
              archivedBy: req.appUser!.id,
              archivedByName: req.appUser!.fullName,
              archivalReason: reason || 'Konfirmasi pengarsipan pasca jadwal selesai',
              isActiveArchive: true,
            });

            await tx.insert(documentEvents).values({
              spsDocumentId: doc.id,
              eventType: 'ARCHIVED',
              actorId: req.appUser!.id,
              actorName: req.appUser!.fullName,
              details: { reason },
            });

            return updated;
          } else {
            const [policySetting] = await tx
              .select()
              .from(systemSettings)
              .where(eq(systemSettings.key, 'archival_policy'))
              .limit(1);
            const deferDays =
              (policySetting?.value as { deferIntervalDays?: number })?.deferIntervalDays || 7;
            const deferUntil = new Date(Date.now() + deferDays * 86400 * 1000);

            const [updated] = await tx
              .update(spsDocuments)
              .set({
                lifecycleStatus: 'ARCHIVAL_DEFERRED',
                archivalDeferredUntil: deferUntil,
                updatedAt: new Date(),
              })
              .where(eq(spsDocuments.id, spsId))
              .returning();

            await tx.insert(documentEvents).values({
              spsDocumentId: doc.id,
              eventType: 'ARCHIVAL_DEFERRED',
              actorId: req.appUser!.id,
              actorName: req.appUser!.fullName,
              details: { deferUntil, reason },
            });

            return updated;
          }
        });

        await createNotification({
          recipientRole: 'SPV_SAMPLING',
          eventType: decision === 'ARCHIVE' ? 'ARCHIVAL_COMPLETED' : 'ARCHIVAL_DEFERRED',
          title: decision === 'ARCHIVE' ? 'SPS Dipindahkan ke Arsip' : 'Pengarsipan SPS Ditunda',
          recordNumber: result.spsNumber,
          description:
            decision === 'ARCHIVE'
              ? `SPS ${result.spsNumber} berhasil diarsipkan.`
              : `SPS ${result.spsNumber} tetap aktif dengan status Pengarsipan Ditunda.`,
          targetRoute: decision === 'ARCHIVE' ? 'archive' : 'sps',
          targetId: result.id,
        });

        await writeAudit({
          user: req.appUser,
          action: decision === 'ARCHIVE' ? 'ARCHIVE_SPS_DOCUMENT' : 'DEFER_SPS_ARCHIVAL',
          entityType: 'SPS_DOCUMENT',
          entityId: result.id,
          entityNumber: result.spsNumber,
          notes: reason,
        });

        res.json(result);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memproses keputusan arsip.' });
      }
    }
  );

  router.get('/sps/:id/pdf', async (req: AuthRequest, res) => {
    try {
      const spsId = String(req.params.id);
      const [doc] = await db
        .select()
        .from(spsDocuments)
        .where(eq(spsDocuments.id, spsId))
        .limit(1);
      if (!doc) return res.status(404).json({ error: 'SPS tidak ditemukan.' });

      const pdfBuffer = await generateSpsPdfBuffer({
        spsNumber: doc.spsNumber,
        customerName: doc.customerName,
        customerAddress: doc.customerAddress,
        customerPhone: doc.customerPhone || '-',
        jobName: doc.jobName,
        lhpNumber: doc.lhpNumber,
        contractNumber: doc.contractNumber,
        samplingDateLabel: doc.samplingDateLabel,
        samplingLocation: doc.samplingLocation,
        customerPic: doc.customerPic,
        picPhone: doc.picPhone,
        assignedPersonnelNames: doc.assignedPersonnelNames,
        scheduleRows: doc.scheduleRows,
        matrixRows: doc.matrixRows,
        notes: doc.notes,
        preparedByName: doc.preparedByName,
        revisionNumber: doc.revisionNumber,
        lifecycleStatus: doc.lifecycleStatus,
      });

      const safeFilename = doc.spsNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="SPS_${safeFilename}.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating SPS PDF:', error);
      res.status(500).json({ error: 'Gagal membuat file PDF SPS.' });
    }
  });

  // ==========================================================================
  // DOCUMENT ARCHIVE & RESTORE
  // ==========================================================================
  router.get('/archives', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (_req, res) => {
    try {
      const [archives, docs, revisions, events] = await Promise.all([
        db.select().from(documentArchives).orderBy(desc(documentArchives.archivedAt)),
        db.select().from(spsDocuments),
        db.select().from(spsRevisions).orderBy(desc(spsRevisions.revisionNumber)),
        db.select().from(documentEvents).orderBy(desc(documentEvents.createdAt)),
      ]);

      const enriched = archives
        .filter((a) => a.isActiveArchive)
        .map((a) => {
          const doc = docs.find((d) => d.id === a.spsDocumentId) || null;
          return {
            ...a,
            spsDocument: doc,
            revisions: revisions.filter((r) => r.spsDocumentId === a.spsDocumentId),
            events: events.filter((e) => e.spsDocumentId === a.spsDocumentId),
          };
        });
      res.json(enriched);
    } catch (error) {
      console.error('Error in GET /api/archives:', error);
      res.status(500).json({ error: 'Gagal memuat arsip dokumen.' });
    }
  });

  router.post(
    '/archives/:spsId/restore',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const spsId = String(req.params.spsId);
        const reason = String(req.body?.reason || 'Dipulihkan ke status aktif oleh SPV/Manajemen');

        const restored = await db.transaction(async (tx) => {
          const [doc] = await tx
            .update(spsDocuments)
            .set({
              lifecycleStatus: 'ARCHIVAL_DEFERRED',
              archivalDeferredUntil: new Date(Date.now() + 7 * 86400 * 1000),
              updatedAt: new Date(),
            })
            .where(eq(spsDocuments.id, spsId))
            .returning();
          if (!doc) throw new Error('Dokumen tidak ditemukan.');

          await tx
            .update(documentArchives)
            .set({
              isActiveArchive: false,
              restoredAt: new Date(),
              restoredBy: req.appUser!.id,
            })
            .where(and(eq(documentArchives.spsDocumentId, spsId), eq(documentArchives.isActiveArchive, true)));

          await tx.insert(documentEvents).values({
            spsDocumentId: spsId,
            eventType: 'RESTORED_FROM_ARCHIVE',
            actorId: req.appUser!.id,
            actorName: req.appUser!.fullName,
            details: { reason },
          });

          return doc;
        });

        await writeAudit({
          user: req.appUser,
          action: 'RESTORE_SPS_FROM_ARCHIVE',
          entityType: 'SPS_DOCUMENT',
          entityId: restored.id,
          entityNumber: restored.spsNumber,
          notes: reason,
        });

        res.json(restored);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memulihkan dokumen.' });
      }
    }
  );

  // ==========================================================================
  // SPS TEMPLATE LIBRARY & REUSE
  // ==========================================================================
  router.get('/templates', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (_req, res) => {
    try {
      const [templates, docs] = await Promise.all([
        db.select().from(spsTemplates).orderBy(desc(spsTemplates.createdAt)),
        db.select().from(spsDocuments),
      ]);
      res.json(
        templates.map((t) => ({
          ...t,
          sourceSps: docs.find((d) => d.id === t.sourceSpsId) || null,
        }))
      );
    } catch (error) {
      console.error('Error in GET /api/templates:', error);
      res.status(500).json({ error: 'Gagal memuat pustaka template SPS.' });
    }
  });

  router.delete('/templates/:id', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const templateId = String(req.params.id);
      const [existing] = await db
        .select()
        .from(spsTemplates)
        .where(eq(spsTemplates.id, templateId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Template SPS tidak ditemukan.' });

      await db.delete(spsTemplates).where(eq(spsTemplates.id, templateId));

      await writeAudit({
        user: req.appUser,
        action: 'DELETE_SPS_TEMPLATE',
        entityType: 'SPS_TEMPLATE',
        entityId: existing.id,
        entityNumber: existing.originalSpsNumber,
        beforeState: { templateName: existing.templateName, customerName: existing.customerName },
      });

      res.json({ ok: true, deletedId: templateId });
    } catch (error) {
      console.error('Error in DELETE /api/templates/:id:', error);
      res.status(500).json({ error: 'Gagal menghapus template SPS.' });
    }
  });

  // Scenario 9: Reuse previous SPS as template -> creates a NEW DRAFT sampling request, never mutates original SPS!
  router.post('/templates/:id/use', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const templateId = String(req.params.id);
      const [tpl] = await db
        .select()
        .from(spsTemplates)
        .where(eq(spsTemplates.id, templateId))
        .limit(1);
      if (!tpl) return res.status(404).json({ error: 'Template SPS tidak ditemukan.' });

      const newReq = await db.transaction(async (tx) => {
        const now = new Date();
        const requestNumber = `REQ/AKL/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${Date.now().toString().slice(-4)}`;
        const tplStart = new Date(Date.now() + 7 * 86400000);

        const [createdReq] = await tx
          .insert(samplingRequests)
          .values({
            requestNumber,
            createdBy: req.appUser!.id,
            createdByName: req.appUser!.fullName,
            customerName: tpl.customerName,
            customerAddress: tpl.customerAddress || '-',
            customerPic: tpl.customerPic || '-',
            picPhone: tpl.picPhone || '-',
            jobName: tpl.jobName,
            jobDescription: tpl.activityDescription || tpl.jobName,
            proposedDate: tplStart,
            proposedEndDate: new Date(tplStart.getTime() + 8 * 3600 * 1000),
            proposedTime: '08:00',
            estimatedDurationHours: 8,
            mobilizationHours: 2,
            samplingLocation: tpl.samplingLocation || tpl.customerAddress || '-',
            specialInstructions: tpl.defaultNotes || '',
            status: 'DRAFT',
            sourceTemplateId: tpl.id,
            revisionNumber: 1,
          })
          .returning();

        for (let i = 0; i < tpl.matrixConfig.length; i++) {
          const m = tpl.matrixConfig[i];
          const [insertedM] = await tx
            .insert(requestMatrices)
            .values({
              requestId: createdReq.id,
              matrixName: m.matrixName,
              pointCount: m.pointCount || 1,
              pointDescription: m.pointLocations || 'Sesuai ketentuan pelanggan',
              regulationName: m.regulation || '-',
              sortOrder: i,
            })
            .returning();

          const regParams = (m.parameters || '')
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);
          const subParams = (m.subcontractedParameters || '')
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);

          const paramRows = [
            ...regParams.map((p) => ({
              requestMatrixId: insertedM.id,
              parameterName: p,
              unit: '-',
              isSubcontracted: false,
            })),
            ...subParams.map((p) => ({
              requestMatrixId: insertedM.id,
              parameterName: p,
              unit: '-',
              isSubcontracted: true,
            })),
          ];

          if (paramRows.length > 0) {
            await tx.insert(requestMatrixParameters).values(paramRows);
          }
        }

        await tx
          .update(spsTemplates)
          .set({ lastUsedAt: new Date() })
          .where(eq(spsTemplates.id, tpl.id));

        return createdReq;
      });

      await writeAudit({
        user: req.appUser,
        action: 'REUSE_SPS_TEMPLATE',
        entityType: 'SAMPLING_REQUEST',
        entityId: newReq.id,
        entityNumber: newReq.requestNumber,
        notes: `Dibuat dari template ${tpl.templateName} (SPS asal: ${tpl.originalSpsNumber})`,
      });

      res.status(201).json(newReq);
    } catch (error) {
      console.error('Error in POST /api/templates/:id/use:', error);
      res.status(500).json({ error: 'Gagal menggunakan template SPS.' });
    }
  });

  // ==========================================================================
  // SPS MASTER DATABASE — EXCEL & PDF IMPORT CENTER
  // ==========================================================================
  router.get('/import/batches', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (_req, res) => {
    try {
      const [batches, records] = await Promise.all([
        db.select().from(spsImportBatches).orderBy(desc(spsImportBatches.uploadedAt)),
        db.select().from(spsImportRecords).orderBy(asc(spsImportRecords.sourcePage)),
      ]);
      res.json(
        batches.map((b) => ({
          ...b,
          records: records.filter((r) => r.batchId === b.id),
        }))
      );
    } catch (error) {
      console.error('Error in GET /api/import/batches:', error);
      res.status(500).json({ error: 'Gagal memuat riwayat impor SPS.' });
    }
  });

  router.post(
    '/import/excel',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    upload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: 'File Excel/CSV wajib diunggah.' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
          return res.status(400).json({ error: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv.' });
        }

        const storageKey = savePrivateUpload(req.file.originalname, req.file.buffer);
        const parsedBook = parseSpreadsheetBuffer(req.file.buffer);
        const sheetName =
          typeof req.body.sheetName === 'string' && req.body.sheetName
            ? req.body.sheetName
            : parsedBook.sheets[0]?.name;
        const selectedSheet =
          parsedBook.sheets.find((s) => s.name === sheetName) || parsedBook.sheets[0];

        if (!selectedSheet || selectedSheet.rows.length === 0) {
          return res.status(400).json({ error: 'Worksheet kosong atau tidak memiliki baris data.' });
        }

        let customMapping: Record<string, string> = {};
        if (typeof req.body.columnMapping === 'string' && req.body.columnMapping) {
          customMapping = JSON.parse(req.body.columnMapping);
        }

        const mappedRecords = mapExcelRowsToSpsRecords(selectedSheet.rows, customMapping);
        const existingSps = await db.select().from(spsDocuments);

        const batch = await db.transaction(async (tx) => {
          const [b] = await tx
            .insert(spsImportBatches)
            .values({
              originalFilename: req.file!.originalname,
              fileType: ext.replace('.', '').toUpperCase(),
              storagePath: storageKey,
              uploadedBy: req.appUser!.id,
              uploadedByName: req.appUser!.fullName,
              processingStatus: 'EXTRACTED',
              totalRecords: mappedRecords.length,
              columnMapping: customMapping,
            })
            .returning();

          let dupCount = 0;
          const recordRows = mappedRecords.map((item, idx) => {
            const dup = detectSpsDuplicate(
              {
                spsNumber: item.extractedData.document_number,
                customerName: item.extractedData.customer_name,
                jobName: item.extractedData.job_name,
                samplingDateLabel: item.extractedData.sampling_date,
              },
              existingSps
            );
            if (dup.duplicateStatus !== 'NONE') dupCount++;
            return {
              batchId: b.id,
              sourcePage: idx + 1,
              extractedData: item.extractedData,
              confidenceData: { overall: item.missingFields.length === 0 ? 0.95 : 0.6 },
              validationStatus: 'PENDING_REVIEW',
              duplicateStatus: dup.duplicateStatus,
              duplicateSpsId: dup.matchedSpsId || null,
              missingFields: item.missingFields,
              warnings: dup.reason ? [...item.warnings, dup.reason] : item.warnings,
            };
          });

          const insertedRecs = await tx.insert(spsImportRecords).values(recordRows).returning();
          await tx
            .update(spsImportBatches)
            .set({ duplicateRecords: dupCount })
            .where(eq(spsImportBatches.id, b.id));

          return { batch: { ...b, duplicateRecords: dupCount }, records: insertedRecs, sheets: parsedBook.sheets.map((s) => ({ name: s.name, headers: s.headers, rowCount: s.rows.length })) };
        });

        await writeAudit({
          user: req.appUser,
          action: 'UPLOAD_EXCEL_IMPORT_BATCH',
          entityType: 'SPS_IMPORT_BATCH',
          entityId: batch.batch.id,
          entityNumber: req.file.originalname,
          notes: `Terdeteksi ${mappedRecords.length} baris SPS`,
        });

        res.status(201).json(batch);
      } catch (error: unknown) {
        console.error('Error in POST /api/import/excel:', error);
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memproses file Excel.' });
      }
    }
  );

  router.post(
    '/import/pdf',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    upload.single('file'),
    async (req: AuthRequest, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: 'File PDF wajib diunggah.' });
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (ext !== '.pdf') {
          return res.status(400).json({ error: 'Hanya file PDF yang diizinkan pada endpoint ini.' });
        }

        const storageKey = savePrivateUpload(req.file.originalname, req.file.buffer);
        const extracted = await extractSpsRecordsFromPdfWithAI(
          req.file.buffer,
          req.file.originalname
        );
        const existingSps = await db.select().from(spsDocuments);

        const result = await db.transaction(async (tx) => {
          const [b] = await tx
            .insert(spsImportBatches)
            .values({
              originalFilename: req.file!.originalname,
              fileType: 'PDF',
              storagePath: storageKey,
              uploadedBy: req.appUser!.id,
              uploadedByName: req.appUser!.fullName,
              processingStatus: 'EXTRACTED',
              totalRecords: extracted.records.length,
            })
            .returning();

          let dupCount = 0;
          const recordValues = extracted.records.map((rec) => {
            const dup = detectSpsDuplicate(
              {
                spsNumber: rec.document_number,
                customerName: rec.customer_name,
                jobName: rec.job_name,
                samplingDateLabel: rec.sampling_date,
              },
              existingSps
            );
            if (dup.duplicateStatus !== 'NONE') dupCount++;
            return {
              batchId: b.id,
              sourcePage: rec.source_page,
              extractedData: rec,
              confidenceData: rec.confidence,
              validationStatus: 'PENDING_REVIEW',
              duplicateStatus: dup.duplicateStatus,
              duplicateSpsId: dup.matchedSpsId || null,
              missingFields: rec.missing_fields,
              warnings: dup.reason ? [...rec.warnings, dup.reason] : rec.warnings,
            };
          });

          const insertedRecs =
            recordValues.length > 0
              ? await tx.insert(spsImportRecords).values(recordValues).returning()
              : [];

          await tx
            .update(spsImportBatches)
            .set({ duplicateRecords: dupCount })
            .where(eq(spsImportBatches.id, b.id));

          return {
            batch: { ...b, duplicateRecords: dupCount },
            records: insertedRecs,
            extractionMethod: extracted.extractionMethod,
            pageCount: extracted.pageCount,
          };
        });

        await writeAudit({
          user: req.appUser,
          action: 'UPLOAD_PDF_IMPORT_BATCH',
          entityType: 'SPS_IMPORT_BATCH',
          entityId: result.batch.id,
          entityNumber: req.file.originalname,
          notes: `Metode: ${result.extractionMethod}, ${result.records.length} dokumen terdeteksi`,
        });

        res.status(201).json(result);
      } catch (error: unknown) {
        console.error('Error in POST /api/import/pdf:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Gagal mengekstrak PDF SPS.' });
      }
    }
  );

  // Import built-in Historical ANKAL PDF sample for instant testing
  router.post(
    '/import/sample-historical-pdf',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const samplePath = path.resolve(process.cwd(), 'public', 'assets', 'aistudio', 'Historical_SPS_83339424.pdf');
        if (!fs.existsSync(samplePath)) {
          return res.status(404).json({ error: 'File contoh Historical SPS PDF tidak ditemukan.' });
        }
        const buffer = fs.readFileSync(samplePath);
        const storageKey = savePrivateUpload('Historical_SPS_ANKAL.pdf', buffer);
        const extracted = await extractSpsRecordsFromPdfWithAI(buffer, 'Historical_SPS_ANKAL.pdf');
        const existingSps = await db.select().from(spsDocuments);

        const result = await db.transaction(async (tx) => {
          const [b] = await tx
            .insert(spsImportBatches)
            .values({
              originalFilename: 'Historical_SPS_ANKAL.pdf',
              fileType: 'PDF',
              storagePath: storageKey,
              uploadedBy: req.appUser!.id,
              uploadedByName: req.appUser!.fullName,
              processingStatus: 'EXTRACTED',
              totalRecords: extracted.records.length,
            })
            .returning();

          let dupCount = 0;
          const recordValues = extracted.records.map((rec) => {
            const dup = detectSpsDuplicate(
              {
                spsNumber: rec.document_number,
                customerName: rec.customer_name,
                jobName: rec.job_name,
                samplingDateLabel: rec.sampling_date,
              },
              existingSps
            );
            if (dup.duplicateStatus !== 'NONE') dupCount++;
            return {
              batchId: b.id,
              sourcePage: rec.source_page,
              extractedData: rec,
              confidenceData: rec.confidence,
              validationStatus: 'PENDING_REVIEW',
              duplicateStatus: dup.duplicateStatus,
              duplicateSpsId: dup.matchedSpsId || null,
              missingFields: rec.missing_fields,
              warnings: dup.reason ? [...rec.warnings, dup.reason] : rec.warnings,
            };
          });

          const insertedRecs =
            recordValues.length > 0
              ? await tx.insert(spsImportRecords).values(recordValues).returning()
              : [];
          await tx
            .update(spsImportBatches)
            .set({ duplicateRecords: dupCount })
            .where(eq(spsImportBatches.id, b.id));

          return {
            batch: { ...b, duplicateRecords: dupCount },
            records: insertedRecs,
            extractionMethod: extracted.extractionMethod,
            pageCount: extracted.pageCount,
          };
        });

        res.status(201).json(result);
      } catch (error: unknown) {
        console.error('Error importing sample PDF:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Gagal mengekstrak PDF historis.' });
      }
    }
  );

  router.patch(
    '/import/records/:recordId',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const recordId = String(req.params.recordId);
        const schema = z.object({
          extractedData: z.record(z.string(), z.unknown()),
          validationStatus: z.enum(['PENDING_REVIEW', 'DRAFT', 'VERIFIED', 'REJECTED']).optional(),
        });
        const parsed = schema.parse(req.body);
        const [updated] = await db
          .update(spsImportRecords)
          .set({
            extractedData: parsed.extractedData,
            ...(parsed.validationStatus ? { validationStatus: parsed.validationStatus } : {}),
          })
          .where(eq(spsImportRecords.id, recordId))
          .returning();
        if (!updated) return res.status(404).json({ error: 'Baris impor tidak ditemukan.' });
        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memperbarui data ekstraksi.' });
      }
    }
  );

  router.post(
    '/import/records/:recordId/confirm',
    requireRole('SPV_SAMPLING', 'MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const recordId = String(req.params.recordId);
        const resolveDuplicateAsSeparate = Boolean(req.body?.resolveDuplicateAsSeparate);
        const overrideSpsNumber =
          typeof req.body?.overrideSpsNumber === 'string' ? req.body.overrideSpsNumber.trim() : '';

        const outcome = await db.transaction(async (tx) => {
          const [rec] = await tx
            .select()
            .from(spsImportRecords)
            .where(eq(spsImportRecords.id, recordId))
            .limit(1);
          if (!rec) throw new Error('Baris impor tidak ditemukan.');

          const [batch] = await tx
            .select()
            .from(spsImportBatches)
            .where(eq(spsImportBatches.id, rec.batchId))
            .limit(1);

          const data = rec.extractedData as Record<string, unknown>;
          let docNum = overrideSpsNumber || String(data.document_number || '').trim();
          const custName = String(data.customer_name || '').trim();
          const jobName = String(data.job_name || 'Pemantauan Lingkungan').trim();

          if (!docNum || !custName) {
            throw new Error('Nomor SPS dan Nama Pelanggan wajib dilengkapi sebelum konfirmasi impor.');
          }

          const existingMatch = await tx
            .select()
            .from(spsDocuments)
            .where(eq(spsDocuments.spsNumber, docNum))
            .limit(1);

          if (existingMatch.length > 0) {
            if (!resolveDuplicateAsSeparate) {
              throw new Error(
                `Duplikat Nomor SPS terdeteksi (${docNum}). Pilih resolusi duplikat atau ubah nomor identifikasi sumber.`
              );
            }
            docNum = `${docNum}-SRC-${Date.now().toString().slice(-4)}`;
          }

          // Normalize matrices from either Excel flat format or PDF structured array
          const rawMatrices = Array.isArray(data.matrices)
            ? (data.matrices as Array<Record<string, unknown>>)
            : [
                {
                  matrix_name: String(data.matrix_name || 'Air Limbah'),
                  sampling_point_count: Number(data.sampling_point_count || 1),
                  sampling_points: String(data.sampling_points || 'Sesuai ketentuan pelanggan'),
                  parameters: String(data.parameters || '-'),
                  subcontracted_parameters: String(data.subcontracted_parameters || ''),
                  applicable_regulation: String(data.applicable_regulation || '-'),
                },
              ];

          const matrixRows = rawMatrices.map((m, idx) => ({
            no: idx + 1,
            dateLabel: String(data.sampling_date || '-'),
            matrixName: String(m.matrix_name || '-'),
            pointCount: Number(m.sampling_point_count || 1),
            pointLocations: String(m.sampling_points || 'Sesuai ketentuan pelanggan'),
            parameters: String(m.parameters || '-'),
            subcontractedParameters: String(m.subcontracted_parameters || ''),
            regulation: String(m.applicable_regulation || '-'),
          }));

          const personnelNames = Array.isArray(data.sampling_personnel)
            ? data.sampling_personnel.map((s) => String(s).trim()).filter(Boolean)
            : String(data.sampling_personnel || data.assigned_personnel || '')
                .split(/[,;\n]/)
                .map((s) => s.trim())
                .filter(Boolean);

          const [createdSps] = await tx
            .insert(spsDocuments)
            .values({
              spsNumber: docNum,
              customerName: custName,
              customerAddress: String(data.customer_address || '-'),
              customerPic: String(data.customer_pic || '-'),
              picPhone: String(data.pic_phone || '-'),
              jobName,
              lhpNumber: String(data.lhp_number || ''),
              samplingDateLabel: String(data.sampling_date || '-'),
              samplingLocation: String(data.sampling_location || data.customer_address || '-'),
              assignedPersonnelNames: personnelNames,
              scheduleRows: [
                {
                  dateLabel: String(data.sampling_date || '-'),
                  activity: String(data.sampling_activities || jobName),
                  notes: '-',
                },
              ],
              matrixRows,
              notes: String(data.notes || ''),
              lifecycleStatus: 'ARCHIVED',
              archivedAt: new Date(),
              archivedBy: req.appUser!.id,
              isHistoricalImport: true,
              isImmutable: true,
              createdBy: req.appUser!.id,
            })
            .returning();

          await tx.insert(documentArchives).values({
            spsDocumentId: createdSps.id,
            spsNumber: createdSps.spsNumber,
            customerName: createdSps.customerName,
            jobName: createdSps.jobName,
            samplingYear: new Date().getFullYear(),
            matricesSummary: matrixRows.map((m) => m.matrixName).join(', '),
            personnelSummary: personnelNames.join(', '),
            archivedBy: req.appUser!.id,
            archivedByName: req.appUser!.fullName,
            archivalReason: `Impor Master SPS (${batch?.fileType || 'FILE'})`,
            isActiveArchive: true,
          });

          await tx.insert(spsTemplates).values({
            templateName: `${custName} — ${jobName} (${docNum})`,
            sourceSpsId: createdSps.id,
            originalSpsNumber: createdSps.spsNumber,
            customerName: createdSps.customerName,
            customerAddress: createdSps.customerAddress,
            customerPic: createdSps.customerPic,
            picPhone: createdSps.picPhone,
            jobName: createdSps.jobName,
            samplingLocation: createdSps.samplingLocation,
            activityDescription: String(data.sampling_activities || jobName),
            defaultNotes: String(data.notes || ''),
            matrixConfig: matrixRows,
            createdBy: req.appUser!.id,
          });

          if (batch) {
            await tx.insert(spsSourceFiles).values({
              spsDocumentId: createdSps.id,
              originalFilename: batch.originalFilename,
              storagePath: batch.storagePath,
              sourceType: batch.fileType,
              fileSizeBytes: 0,
            });
            await tx
              .update(spsImportBatches)
              .set({
                successfulRecords: batch.successfulRecords + 1,
                processingStatus: 'COMPLETED',
              })
              .where(eq(spsImportBatches.id, batch.id));
          }

          await tx
            .update(spsImportRecords)
            .set({
              validationStatus: 'IMPORTED',
              duplicateStatus: resolveDuplicateAsSeparate ? 'RESOLVED_SEPARATE' : rec.duplicateStatus,
              verifiedBy: req.appUser!.id,
              verifiedAt: new Date(),
              importedSpsId: createdSps.id,
            })
            .where(eq(spsImportRecords.id, recordId));

          return createdSps;
        });

        await writeAudit({
          user: req.appUser,
          action: 'CONFIRM_SPS_IMPORT_RECORD',
          entityType: 'SPS_DOCUMENT',
          entityId: outcome.id,
          entityNumber: outcome.spsNumber,
          afterState: outcome,
        });

        res.status(201).json(outcome);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Gagal mengonfirmasi impor SPS.';
        res.status(msg.includes('Duplikat') ? 409 : 400).json({ error: msg });
      }
    }
  );

  router.get('/import/batches/:id/source-file', requireRole('SPV_SAMPLING', 'MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const [batch] = await db
        .select()
        .from(spsImportBatches)
        .where(eq(spsImportBatches.id, String(req.params.id)))
        .limit(1);
      if (!batch) return res.status(404).json({ error: 'Batch impor tidak ditemukan.' });

      const resolved = resolvePrivateUploadPath(batch.storagePath);
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: 'File sumber asli tidak ditemukan di penyimpanan.' });
      }
      if (batch.fileType === 'PDF') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${batch.originalFilename}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${batch.originalFilename}"`);
      }
      res.sendFile(resolved);
    } catch (error) {
      console.error('Error serving source file:', error);
      res.status(500).json({ error: 'Gagal membuka file sumber impor.' });
    }
  });

  // ==========================================================================
  // NOTIFICATIONS, REPORTS, USERS, SETTINGS & AUDIT LOGS
  // ==========================================================================
  router.get('/notifications', async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      const filtered = rows.filter((n) => {
        if (req.appUser!.role === 'MANAGEMENT') return true;
        if (n.recipientUserId && n.recipientUserId === req.appUser!.id) return true;
        if (n.recipientRole && n.recipientRole === req.appUser!.role) return true;
        return !n.recipientRole && !n.recipientUserId;
      });
      res.json(filtered);
    } catch (error) {
      console.error('Error in GET /api/notifications:', error);
      res.status(500).json({ error: 'Gagal memuat notifikasi.' });
    }
  });

  router.post('/notifications/:id/read', async (req, res) => {
    try {
      const [updated] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, String(req.params.id)))
        .returning();
      res.json(updated);
    } catch {
      res.status(500).json({ error: 'Gagal menandai notifikasi.' });
    }
  });

  router.post('/notifications/read-all', async (_req, res) => {
    try {
      await db.update(notifications).set({ isRead: true });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Gagal menandai semua notifikasi.' });
    }
  });

  router.get('/reports', requireRole('MANAGEMENT'), async (_req, res) => {
    try {
      const [reqs, assigns, pers, vehs, resList, spsList] = await Promise.all([
        db.select().from(samplingRequests),
        db.select().from(personnelAssignments),
        db.select().from(personnel),
        db.select().from(vehicles),
        db.select().from(vehicleReservations),
        db.select().from(spsDocuments),
      ]);

      const byStatus: Record<string, number> = {};
      for (const r of reqs) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      }

      const personnelStats = pers.map((p) => {
        const countAssign = assigns.filter(
          (a) => a.personnelId === p.id && a.assignmentStatus === 'CONFIRMED'
        ).length;
        return {
          id: p.id,
          code: p.code,
          fullName: p.fullName,
          category: p.category,
          confirmedAssignments: countAssign,
        };
      });

      const vehicleStats = vehs.map((v) => {
        const countRes = resList.filter(
          (r) => r.vehicleId === v.id && r.status !== 'CANCELLED'
        ).length;
        return {
          id: v.id,
          vehicleCode: v.vehicleCode,
          registrationNumber: v.registrationNumber,
          model: v.model,
          operationalStatus: v.operationalStatus,
          reservationCount: countRes,
        };
      });

      res.json({
        totalRequests: reqs.length,
        totalSps: spsList.length,
        statusBreakdown: byStatus,
        personnelStats,
        vehicleStats,
      });
    } catch (error) {
      console.error('Error in GET /api/reports:', error);
      res.status(500).json({ error: 'Gagal memuat laporan analitik.' });
    }
  });

  router.get('/users', requireRole('MANAGEMENT'), async (_req, res) => {
    try {
      const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
      res.json(allUsers.map((u) => sanitizePublicUser(u)));
    } catch {
      res.status(500).json({ error: 'Gagal memuat daftar pengguna.' });
    }
  });

  router.post('/users/preapprove', requireRole('MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        fullName: z.string().min(2),
        role: z.enum(['KAE_SALES', 'SPV_SAMPLING', 'MANAGEMENT']).default('KAE_SALES'),
      });
      const parsed = schema.parse(req.body);
      const normalizedEmail = parsed.email.trim().toLowerCase();
      if (normalizedEmail === MASTER_ADMIN_EMAIL && parsed.role !== 'MANAGEMENT') {
        return res.status(403).json({ error: 'Akun Superadmin tidak dapat diubah perannya.' });
      }

      const existing = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalizedEmail}`)
        .limit(1);

      if (existing.length > 0) {
        if (existing[0].email.toLowerCase() === MASTER_ADMIN_EMAIL) {
          return res.status(403).json({ error: 'Akun Superadmin tidak dapat diubah melalui form ini.' });
        }
        const [updated] = await db
          .update(users)
          .set({
            fullName: parsed.fullName,
            role: parsed.role,
            approvalStatus: 'APPROVED',
            approvedBy: req.appUser!.id,
            approvedAt: new Date(),
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing[0].id))
          .returning();

        const safeUpdated = sanitizePublicUser(updated);
        await writeAudit({
          user: req.appUser,
          action: 'PREAPPROVE_USER_REGISTRATION',
          entityType: 'USER',
          entityId: updated.id,
          entityNumber: updated.email,
          afterState: safeUpdated,
        });
        return res.status(200).json(safeUpdated);
      }

      const [created] = await db
        .insert(users)
        .values({
          uid: `preapproved:${normalizedEmail}`,
          email: normalizedEmail,
          fullName: parsed.fullName.trim(),
          role: parsed.role,
          approvalStatus: 'APPROVED',
          approvedBy: req.appUser!.id,
          approvedAt: new Date(),
          isActive: true,
        })
        .returning();

      const safeCreated = sanitizePublicUser(created);
      await writeAudit({
        user: req.appUser,
        action: 'PREAPPROVE_USER_REGISTRATION',
        entityType: 'USER',
        entityId: created.id,
        entityNumber: created.email,
        afterState: safeCreated,
      });

      res.status(201).json(safeCreated);
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Gagal mendaftarkan pengguna.',
      });
    }
  });

  router.post('/users/:id/approval', requireRole('MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        role: z.enum(['KAE_SALES', 'SPV_SAMPLING', 'MANAGEMENT']).optional(),
      });
      const parsed = schema.parse(req.body);
      const targetId = String(req.params.id);

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

      if (existing.email.toLowerCase() === MASTER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Status Superadmin tidak dapat diubah.' });
      }
      if (existing.id === req.appUser!.id && parsed.decision === 'REJECTED') {
        return res.status(400).json({ error: 'Anda tidak dapat menolak akun Anda sendiri.' });
      }

      const [updated] = await db
        .update(users)
        .set({
          approvalStatus: parsed.decision,
          ...(parsed.role ? { role: parsed.role } : {}),
          approvedBy: req.appUser!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetId))
        .returning();

      await writeAudit({
        user: req.appUser,
        action: parsed.decision === 'APPROVED' ? 'APPROVE_USER_REGISTRATION' : 'REJECT_USER_REGISTRATION',
        entityType: 'USER',
        entityId: updated.id,
        entityNumber: updated.email,
        beforeState: { approvalStatus: existing.approvalStatus, role: existing.role },
        afterState: { approvalStatus: updated.approvalStatus, role: updated.role },
      });

      res.json(sanitizePublicUser(updated));
    } catch (error: unknown) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Gagal memproses persetujuan registrasi.',
      });
    }
  });

  router.patch('/users/:id', requireRole('MANAGEMENT'), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        role: z.enum(['KAE_SALES', 'SPV_SAMPLING', 'MANAGEMENT']).optional(),
        isActive: z.boolean().optional(),
        fullName: z.string().min(2).optional(),
        approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      });
      const parsed = schema.parse(req.body);
      const targetId = String(req.params.id);

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      if (!existing) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

      if (existing.email.toLowerCase() === MASTER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Akun Superadmin terlindungi dan tidak dapat diubah atau dinonaktifkan.' });
      }
      if (targetId === req.appUser!.id && parsed.isActive === false) {
        return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
      }

      const [updated] = await db
        .update(users)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        .returning();

      await writeAudit({
        user: req.appUser,
        action: 'UPDATE_USER_ROLE',
        entityType: 'USER',
        entityId: updated.id,
        entityNumber: updated.email,
        afterState: parsed,
      });

      res.json(sanitizePublicUser(updated));
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal memperbarui pengguna.' });
    }
  });

  router.get('/settings', requireRole('MANAGEMENT'), async (_req, res) => {
    try {
      const rows = await db.select().from(systemSettings);
      res.json(rows);
    } catch {
      res.status(500).json({ error: 'Gagal memuat pengaturan sistem.' });
    }
  });

  router.put(
    '/settings/:key',
    requireRole('MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const key = String(req.params.key);
        const value = req.body.value;
        const [updated] = await db
          .insert(systemSettings)
          .values({
            key,
            value,
            updatedBy: req.appUser!.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value, updatedBy: req.appUser!.id, updatedAt: new Date() },
          })
          .returning();

        await writeAudit({
          user: req.appUser,
          action: 'UPDATE_SYSTEM_SETTING',
          entityType: 'SETTING',
          entityId: updated.id,
          entityNumber: key,
          afterState: value,
        });

        res.json(updated);
      } catch (error: unknown) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Gagal menyimpan pengaturan.' });
      }
    }
  );

  router.post(
    '/settings/reset-demo',
    requireRole('MANAGEMENT'),
    async (req: AuthRequest, res) => {
      try {
        const outcome = await ensureMasterAndDemoData(req.appUser!.id, true);
        res.json(outcome);
      } catch (error) {
        console.error('Error resetting demo data:', error);
        res.status(500).json({ error: 'Gagal mereset data demonstrasi.' });
      }
    }
  );

  router.get('/audit-logs', requireRole('MANAGEMENT'), async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(150);
      res.json(rows);
    } catch {
      res.status(500).json({ error: 'Gagal memuat log audit.' });
    }
  });

  return router;
}
