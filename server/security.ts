import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

const FORBIDDEN_MOUNT_PREFIXES = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/boot',
  '/var/run',
  '/run',
];

export function isPathWithin(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedBase) return true;
  const baseWithSep = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  return resolvedTarget.startsWith(baseWithSep);
}

export function assertSafePathWithin(targetPath: string, baseDir: string): string {
  const resolvedTarget = path.resolve(targetPath);
  if (!isPathWithin(resolvedTarget, baseDir)) {
    throw new Error('Access denied: path escapes permitted storage boundary');
  }
  return resolvedTarget;
}

export function validateExternalMountPath(rawPath: string): { valid: true; resolved: string } | { valid: false; error: string } {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.includes('\0')) {
    return { valid: false, error: 'Mount path is empty or contains invalid characters.' };
  }
  if (!path.isAbsolute(trimmed)) {
    return { valid: false, error: 'External mount path must be an absolute filesystem path (e.g. /mnt/nas/photos).' };
  }

  const resolved = path.resolve(trimmed);
  if (resolved === '/') {
    return { valid: false, error: 'Mounting the filesystem root (/) is not permitted.' };
  }

  for (const prefix of FORBIDDEN_MOUNT_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
      return { valid: false, error: `Mounting system directory ${prefix} is restricted.` };
    }
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { valid: false, error: 'Specified mount path exists but is not a directory.' };
    }
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    return { valid: false, error: 'Directory does not exist or is not readable by the xPhotoLabs service user.' };
  }

  return { valid: true, resolved };
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'untitled');
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').trim();
  return cleaned.slice(0, 180) || 'untitled';
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

export function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateOpaqueToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface TokenAuthResult {
  authenticated: boolean;
  via: 'env' | 'db' | 'none';
  tokenId?: string;
}

export function verifyBearerSyncToken(
  authHeader: string | undefined,
  findTokenByHash: (hash: string) => { id: string } | undefined,
  markTokenUsed: (id: string) => void
): TokenAuthResult {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, via: 'none' };
  }
  const provided = authHeader.slice(7).trim();
  if (!provided) {
    return { authenticated: false, via: 'none' };
  }

  if (config.envSyncApiToken && timingSafeEqualString(provided, config.envSyncApiToken)) {
    return { authenticated: true, via: 'env' };
  }

  const hash = sha256Hex(provided);
  const match = findTokenByHash(hash);
  if (match) {
    markTokenUsed(match.id);
    return { authenticated: true, via: 'db', tokenId: match.id };
  }

  return { authenticated: false, via: 'none' };
}
