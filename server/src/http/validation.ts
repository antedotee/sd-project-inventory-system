import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodType } from 'zod';
import { ValidationError } from '../domain/errors';

/**
 * zod validation for a request part (json body, query, route params).
 * On failure it throws ValidationError, so the global error handler returns
 * the standard error shape with one entry per invalid field.
 */
export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Request is invalid', { location: target, fields });
    }
  });
}
