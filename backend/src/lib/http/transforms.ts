/**
 * Shared class-transformer `@Transform` helpers (Wave F dedup — was 5 byte-identical copies across
 * animal/listing/moderation/reference-data/user-roles DTOs).
 */

/**
 * Parse a string query value `'true'`/`'false'` into a real boolean. class-transformer's
 * `Type(() => Boolean)` is unsafe for query strings (`Boolean('false') === true`), which silently
 * inverted flags like `includeInactive=false`. Anything else is left for `@IsBoolean` to reject.
 */
export function toBool({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
