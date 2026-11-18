/**
 * Error hierarchy for the whole application.
 *
 * Errors describe WHAT went wrong (a `kind` and a stable `code`). They do not
 * know about HTTP. The HTTP layer maps `kind` to a status code in exactly one
 * place (http/error-handler.ts), so the domain stays transport-agnostic.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited';

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly kind = 'validation';
  readonly code = 'VALIDATION_FAILED';
}

export class UnauthenticatedError extends AppError {
  readonly kind = 'unauthenticated';
  readonly code: string = 'UNAUTHENTICATED';
  constructor(message = 'You need to sign in') {
    super(message);
  }
}

export class InvalidCredentialsError extends UnauthenticatedError {
  override readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('Email or password is incorrect');
  }
}

export class ForbiddenError extends AppError {
  readonly kind = 'forbidden';
  readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to do this') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly kind = 'not_found';
  readonly code = 'NOT_FOUND';
  constructor(entity: string, id: string | number) {
    super(`${entity} ${id} was not found`, { entity, id });
  }
}

export abstract class ConflictError extends AppError {
  readonly kind = 'conflict';
}

export class DuplicateError extends ConflictError {
  readonly code = 'DUPLICATE';
}

export class VersionConflictError extends ConflictError {
  readonly code = 'VERSION_CONFLICT';
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was changed by someone else. Reload and try again.`, { entity, id });
  }
}

export interface InsufficientStockDetails {
  productId: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends ConflictError {
  readonly code = 'INSUFFICIENT_STOCK';
  constructor(readonly stock: InsufficientStockDetails) {
    super(`Only ${stock.available} available, ${stock.requested} requested`, stock);
  }
}

export class InvalidStateTransitionError extends ConflictError {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot go from ${from} to ${to}`, { from, to });
  }
}

export class RateLimitedError extends AppError {
  readonly kind = 'rate_limited';
  readonly code = 'RATE_LIMITED';
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
  }
}
