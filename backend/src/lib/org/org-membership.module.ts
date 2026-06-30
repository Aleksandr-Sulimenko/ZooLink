import { Global, Module } from '@nestjs/common';
import { OrgMembershipService } from './org-membership.service';

/**
 * Cross-cutting organization-membership lookups (org-admin scope), available everywhere so the
 * animal / transfer / listing / moderation domains share one definition of "org admin" instead of
 * each re-implementing it. Depends on the global DbModule.
 */
@Global()
@Module({
  providers: [OrgMembershipService],
  exports: [OrgMembershipService],
})
export class OrgMembershipModule {}
