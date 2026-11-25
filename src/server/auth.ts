import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt, sql } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { notifications, userSessions, users } from '../db/schema.ts';

export type AppRole = 'KAE_SALES' | 'SPV_SAMPLING' | 'MANAGEMENT';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AuthenticatedUser {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  role: AppRole;
  actualRole: AppRole;
  approvalStatus: ApprovalStatus;
  departmentId: string | null;
  avatarUrl: string | null;
}

export interface AuthRequest extends Request {
  appUser?: AuthenticatedUser;
}

export const MASTER_ADMIN_EMAIL = 'fachrull.gs@gmail.com';
export const SESSION_COOKIE_NAME = 'ankal_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) return false;
  try {
    const expected = Buffer.from(hexDigest, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createUserSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = `ankal_sess_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(userSessions).values({
    userId,
    tokenHash,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeUserSession(rawToken: string): Promise<void> {
  if (!rawToken || !rawToken.startsWith('ankal_sess_')) return;
  const tokenHash = hashSessionToken(rawToken);
  await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
}

export function parseCookie(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      const val = pair.slice(idx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return '';
}

function isSecureRequest(req: Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  if (isSecureRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`
    );
  }
}

export function clearSessionCookie(req: Request, res: Response): void {
  if (isSecureRequest(req)) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );
  }
}

export function sanitizePublicUser<T extends Record<string, unknown>>(userRow: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _omitted, ...safe } = userRow;
  return safe;
}

export async function findSessionUserByToken(rawToken: string) {
  if (!rawToken || !rawToken.startsWith('ankal_sess_')) return null;
  const tokenHash = hashSessionToken(rawToken);
  const rows = await db
    .select({ user: users })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, new Date())))
    .limit(1);

  if (rows.length === 0) return null;
  const dbUser = rows[0].user;
  if (dbUser.email.toLowerCase() === MASTER_ADMIN_EMAIL && (dbUser.role !== 'MANAGEMENT' || dbUser.approvalStatus !== 'APPROVED')) {
    const [promoted] = await db
      .update(users)
      .set({
        role: 'MANAGEMENT',
        approvalStatus: 'APPROVED',
        approvedAt: dbUser.approvedAt || new Date(),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id))
      .returning();
    return promoted;
  }
  return dbUser;
}

export async function getOrCreateDbUser(decoded: {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}) {
  const email = (decoded.email || `${decoded.uid}@ankal.local`).trim();
  const normalizedEmail = email.toLowerCase();
  const existingByUid = await db
    .select()
    .from(users)
    .where(eq(users.uid, decoded.uid))
    .limit(1);

  if (existingByUid.length > 0) {
    const current = existingByUid[0];
    const isMasterEmail = normalizedEmail === MASTER_ADMIN_EMAIL;
    const updated = await db
      .update(users)
      .set({
        email,
        avatarUrl: decoded.picture || current.avatarUrl || '',
        ...(isMasterEmail
          ? {
              role: 'MANAGEMENT',
              approvalStatus: 'APPROVED',
              approvedAt: current.approvedAt || new Date(),
              isActive: true,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.uid, decoded.uid))
      .returning();
    return updated[0];
  }

  // Check if email already exists (pre-approved by Superadmin or registered with corporate email/password)
  const existingByEmail = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);

  if (existingByEmail.length > 0) {
    const pre = existingByEmail[0];
    const isMasterEmail = normalizedEmail === MASTER_ADMIN_EMAIL;
    const updated = await db
      .update(users)
      .set({
        uid: decoded.uid,
        email,
        fullName: decoded.name || pre.fullName,
        avatarUrl: decoded.picture || pre.avatarUrl || '',
        ...(isMasterEmail
          ? {
              role: 'MANAGEMENT',
              approvalStatus: 'APPROVED',
              approvedAt: pre.approvedAt || new Date(),
              isActive: true,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, pre.id))
      .returning();
    return updated[0];
  }

  // Only designated Master Admin email auto-approves as MANAGEMENT; all other new users require Superadmin approval
  const isInitialMaster = normalizedEmail === MASTER_ADMIN_EMAIL;

  const initialRole: AppRole = isInitialMaster ? 'MANAGEMENT' : 'KAE_SALES';
  const initialApproval: ApprovalStatus = isInitialMaster ? 'APPROVED' : 'PENDING';

  const inserted = await db
    .insert(users)
    .values({
      uid: decoded.uid,
      email,
      fullName: decoded.name || email.split('@')[0] || 'Pengguna ANKAL',
      role: initialRole,
      approvalStatus: initialApproval,
      approvedAt: isInitialMaster ? new Date() : null,
      avatarUrl: decoded.picture || '',
      isActive: true,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        updatedAt: new Date(),
      },
    })
    .returning();

  const createdUser = inserted[0];

  if (createdUser.approvalStatus === 'PENDING') {
    await db.insert(notifications).values({
      recipientRole: 'MANAGEMENT',
      eventType: 'USER_REGISTRATION_PENDING',
      title: 'Permintaan Registrasi Pengguna Baru',
      recordNumber: createdUser.email,
      description: `${createdUser.fullName} (${createdUser.email}) mendaftar via Google dan menunggu persetujuan Superadmin.`,
      targetRoute: 'users',
      targetId: createdUser.id,
      actionRequired: true,
    });
  }

  return createdUser;
}

function passesCookieCsrfCheck(req: Request): boolean {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  if (!mutating) return true;
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') return true;
  const origin = req.headers.origin;
  const expectedHost = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  if (origin && expectedHost) {
    try {
      const originHost = new URL(origin).host;
      return originHost === expectedHost;
    } catch {
      return false;
    }
  }
  return false;
}

export function extractAuthToken(req: Request): { token: string; source: 'bearer' | 'query' | 'cookie' | 'none' } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1].trim();
    if (token) return { token, source: 'bearer' };
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return { token: req.query.token.trim(), source: 'query' };
  }
  const cookieToken = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (cookieToken) {
    return { token: cookieToken, source: 'cookie' };
  }
  return { token: '', source: 'none' };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const { token, source } = extractAuthToken(req);

  if (!token) {
    return res.status(401).json({
      code: 'UNAUTHENTICATED',
      error: 'Autentikasi diperlukan. Silakan masuk terlebih dahulu.',
    });
  }

  if (source === 'cookie' && !passesCookieCsrfCheck(req)) {
    return res.status(403).json({
      code: 'CSRF_CHECK_FAILED',
      error: 'Permintaan lintas-asal tidak diizinkan.',
    });
  }

  try {
    let dbUser;
    if (token.startsWith('ankal_sess_')) {
      dbUser = await findSessionUserByToken(token);
      if (!dbUser) {
        return res.status(401).json({
          code: 'INVALID_TOKEN',
          error: 'Sesi autentikasi tidak valid atau telah kedaluwarsa.',
        });
      }
    } else {
      const decodedToken = await adminAuth.verifyIdToken(token);
      dbUser = await getOrCreateDbUser(decodedToken);
    }

    if (dbUser.approvalStatus === 'REJECTED') {
      return res.status(403).json({
        code: 'REGISTRATION_REJECTED',
        error: 'Permintaan registrasi akun Anda ditolak oleh Superadmin.',
      });
    }

    if (dbUser.approvalStatus !== 'APPROVED') {
      return res.status(403).json({
        code: 'REGISTRATION_PENDING',
        error:
          'Registrasi akun Anda sedang menunggu persetujuan Superadmin. Hubungi administrator PT ANKAL untuk aktivasi.',
      });
    }

    if (!dbUser.isActive) {
      return res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Akun pengguna dinonaktifkan oleh administrator.',
      });
    }

    const actualRole = (dbUser.role as AppRole) || 'KAE_SALES';

    req.appUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      fullName: dbUser.fullName,
      role: actualRole,
      actualRole,
      approvalStatus: dbUser.approvalStatus as ApprovalStatus,
      departmentId: dbUser.departmentId,
      avatarUrl: dbUser.avatarUrl,
    };

    next();
  } catch (error) {
    console.error('Authentication verification error:', error);
    return res.status(401).json({
      code: 'INVALID_TOKEN',
      error: 'Sesi autentikasi tidak valid atau telah kedaluwarsa.',
    });
  }
};

export const requireRole = (...allowedRoles: AppRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.appUser) {
      return res.status(401).json({ error: 'Autentikasi diperlukan.' });
    }
    if (!allowedRoles.includes(req.appUser.role)) {
      return res.status(403).json({
        error: `Akses ditolak. Peran ${req.appUser.role} tidak memiliki izin untuk tindakan ini.`,
      });
    }
    next();
  };
};

