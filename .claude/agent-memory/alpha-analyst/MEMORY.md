# Memory Index

- [DB schema audit findings](project_db_schema_audit.md) — 2026-06-16 audit: 4 domains absent from schema, stateless entities, city_id drift
- [ID type convention](reference_id_type_convention.md) — entities=UUID, lookups(species/breed/city)=INT; where docs drift
- [Identity Slice 4 patterns](project_identity_slice4.md) — erase=tombstone(NOT NULL beats spec), OTP namespace reuse, no-enumeration recovery, revoke-sessions-on-priv-mutation
- [Moderation B10 contract-shape](project_moderation_b10.md) — claim/lock state machine + error codes, SLA/escalation, decision-templates=TABLE (not enum), owner-facing AI-transparency (#5)
