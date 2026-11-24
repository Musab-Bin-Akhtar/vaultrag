import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { logEvent } from './logger.ts';
import type { PublicUser, UserRecord } from './types.ts';

// Keep signing secret in env if provided, otherwise generate an ephemeral per-process 32-byte key.
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

interface TokenPayload {
  userId: string;
  role: 'admin' | 'user';
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function verifyEnvAdminPasscode(candidate: string): boolean {
  const configured = process.env.ADMIN_PASSCODE?.trim();
  if (!configured || !candidate) return false;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hasEnvAdminPasscode(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
}

export function createSessionToken(user: Pick<UserRecord, 'id' | 'role'>): string {
  const payload: TokenPayload = {
    userId: user.id,
    role: user.role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    allowedDocumentIds: [...user.allowedDocumentIds],
    createdAt: user.createdAt,
  };
}

export function makeRequireAuth(getUserById: (id: string) => UserRecord | undefined) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      logEvent({
        level: 'warn',
        category: 'auth',
        action: 'unauthenticated_request',
        statusCode: 401,
        ip: req.ip,
        summary: `Blocked unauthenticated ${req.method} ${req.originalUrl}.`,
      });
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const payload = verifySessionToken(token);
    if (!payload) {
      logEvent({
        level: 'warn',
        category: 'auth',
        action: 'session_expired_or_invalid',
        statusCode: 401,
        ip: req.ip,
        summary: `Rejected expired or invalid session token on ${req.method} ${req.originalUrl}.`,
      });
      res.status(401).json({ error: 'Your session has expired or is invalid. Please sign in again.' });
      return;
    }
    const user = getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists.' });
      return;
    }
    req.authUser = user;
    next();
  };
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.authUser.role !== 'admin') {
    logEvent({
      level: 'warn',
      category: 'permission',
      action: 'admin_route_denied',
      actorId: req.authUser.id,
      actorEmail: req.authUser.email,
      actorRole: req.authUser.role,
      statusCode: 403,
      ip: req.ip,
      summary: `Blocked non-admin user ${req.authUser.email} from ${req.method} ${req.originalUrl}.`,
    });
    res.status(403).json({ error: 'Admin privileges are required for this action.' });
    return;
  }
  next();
}
