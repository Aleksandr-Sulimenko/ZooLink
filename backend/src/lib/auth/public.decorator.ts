import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opt a route out of the global JwtAuthGuard (public endpoint per API_CONVENTIONS §3). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
