/**
 * Postgres SQLSTATE codes we react to. Drizzle may wrap driver errors, so we
 * walk the `cause` chain to find the original code.
 */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

export interface PgErrorInfo {
  code: string;
  constraint?: string;
}

export function pgError(err: unknown): PgErrorInfo | null {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      const constraint = 'constraint_name' in current ? String(current.constraint_name) : undefined;
      return { code: current.code, constraint };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
