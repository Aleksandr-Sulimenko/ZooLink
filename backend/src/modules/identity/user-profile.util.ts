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

export function toUserProfile(u: users): UserProfile {
  return {
    id: u.id,
    fullName: u.full_name,
    role: u.role as Role,
    status: u.status,
    isActive: !INACTIVE.has(u.status), // derived from status (round-4)
    cityId: u.city_id,
    email: u.email,
    emailVerified: u.email_verified ?? false,
    avatarUrl: u.avatar_url,
    preferredLanguage: u.preferred_language,
    createdAt: u.created_at.toISOString(),
  };
}
