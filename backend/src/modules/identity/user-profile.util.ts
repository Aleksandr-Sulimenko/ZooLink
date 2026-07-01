import type { users } from '@prisma/client';
import type { Role } from '../../lib/auth/principal';

/** Safe public projection of a user (never exposes phone_hash / credentials). */
export interface UserProfile {
  id: string;
  fullName: string;
  role: Role;
  status: string;
  isActive: boolean;
  cityId: number | null;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  preferredLanguage: string;
  createdAt: string;
}

const INACTIVE = new Set(['SUSPENDED', 'DEACTIVATED']);

/**
 * @param email the DECRYPTED account email (ADR-0019: `u.email` is AES-256-GCM ciphertext at rest —
 *   callers pass `crypto.decrypt(u.email)` so this projection never leaks ciphertext).
 */
export function toUserProfile(u: users, email: string | null): UserProfile {
  return {
    id: u.id,
    fullName: u.full_name,
    role: u.role as Role,
    status: u.status,
    isActive: !INACTIVE.has(u.status), // derived from status (round-4)
    cityId: u.city_id,
    email,
    emailVerified: u.email_verified ?? false,
    avatarUrl: u.avatar_url,
    preferredLanguage: u.preferred_language,
    createdAt: u.created_at.toISOString(),
  };
}
