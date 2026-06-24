/**
 * Kysely database typings (ADR-0007 escape hatch for geo / complex JSONB / recursive pedigree).
 *
 * PLACEHOLDER until generated. After the schema is loaded into the DB, generate real types with
 * kysely-codegen (or hand-map from database_schema.sql) and replace `Record<string, never>`.
 * Kept as an empty interface so the Kysely instance is typed (not `any`) and compiles pre-codegen.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- placeholder until kysely-codegen fills tables
export interface DB {
  // Generated tables go here, e.g.:
  // animals: AnimalsTable;
  // listings: ListingsTable;
}
