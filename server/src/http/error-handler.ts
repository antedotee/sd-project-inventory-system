import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';
import { AppError, type ErrorKind, RateLimitedError } from '../domain/errors';
import { PG, pgError } from '../infrastructure/db/pg-errors';
import type { AppEnv } from './types';

/** The single place where error kinds become HTTP status codes. */
const STATUS_BY_KIND: Record<ErrorKind, ContentfulStatusCode> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
};

/** Errors raised by Hono itself (malformed JSON, CSRF, body limit). */
const HTTP_EXCEPTIONS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'The request could not be read' },
  403: { code: 'FORBIDDEN', message: 'Cross-site request blocked' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
};

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

interface Mapped {
  status: ContentfulStatusCode;
  code: string;
  message: string;
  details?: unknown;
}

function mapError(err: unknown): Mapped | null {
  if (err instanceof AppError) {
    return { status: STATUS_BY_KIND[err.kind], code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const known = HTTP_EXCEPTIONS[status];
    return { status, code: known?.code ?? 'HTTP_ERROR', message: err.message || known?.message || 'Request failed' };
  }
  // Database constraints are the last line of defence. If one fires, the
  // request conflicted with data rules the app did not catch first.
  const pg = pgError(err);
  if (pg?.code === PG.UNIQUE_VIOLATION) {
    return { status: 409, code: 'DUPLICATE', message: 'This value already exists', details: { constraint: pg.constraint } };
  }
  if (pg?.code === PG.CHECK_VIOLATION) {
    return { status: 409, code: 'CONSTRAINT_VIOLATION', message: 'The change breaks a data rule', details: { constraint: pg.constraint } };
  }
  if (pg?.code === PG.FOREIGN_KEY_VIOLATION) {
    return { status: 409, code: 'REFERENCE_VIOLATION', message: 'A referenced record does not exist or is still in use', details: { constraint: pg.constraint } };
  }
  return null;
}

export function createErrorHandler(logger: Logger) {
  return (err: Error, c: Context<AppEnv>) => {
    const requestId = c.get('requestId') ?? 'unknown';
    const mapped = mapError(err);

    if (!mapped) {
      // Unexpected: log everything, reveal nothing.
      logger.error({ err, requestId, method: c.req.method, path: c.req.path }, 'unhandled error');
      const body: ErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong', requestId } };
      return c.json(body, 500);
    }

    if (err instanceof RateLimitedError) c.header('Retry-After', String(err.retryAfterSeconds));
    if (mapped.status >= 500) logger.error({ err, requestId }, mapped.message);

    const body: ErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined && { details: mapped.details }),
        requestId,
      },
    };
    return c.json(body, mapped.status);
  };
}
