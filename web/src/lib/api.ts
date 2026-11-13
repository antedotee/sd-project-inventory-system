/**
 * Small typed fetch wrapper. Same origin, so the session cookie is sent
 * automatically. Every non-2xx response becomes an ApiError carrying the
 * server's standard error shape.
 */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Network failures and 5xx may succeed on retry; 4xx answers are final. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener = () => {};

/** The auth layer registers what to do when a session expires mid-use. */
export function setUnauthorizedHandler(listener: UnauthorizedListener) {
  onUnauthorized = listener;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;

  const body = (data as ApiErrorBody | null)?.error;
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized();
  throw new ApiError(
    res.status,
    body?.code ?? 'HTTP_ERROR',
    body?.message ?? `Request failed (${res.status})`,
    body?.details,
    body?.requestId,
  );
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { body, headers }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** Field errors from a VALIDATION_FAILED response, keyed by path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {};
  const fields = (error.details as { fields?: { path: string; message: string }[] } | undefined)?.fields ?? [];
  return Object.fromEntries(fields.map((f) => [f.path, f.message]));
}
