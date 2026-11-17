import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth';

export interface FetchCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: FetchCall) => Response | Promise<Response> | 'network-error';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Replaces fetch with a router over "METHOD /path" keys. Records every call. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: FetchCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    const call: FetchCall = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/api/, ''),
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: `no mock for ${call.method} ${call.path}` } });
    const result = await handler(call);
    if (result === 'network-error') throw new TypeError('Failed to fetch');
    return result;
  });
  return calls;
}

export function renderWithProviders(ui: ReactNode, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const staffUser = { id: 'u1', email: 'sam@test', name: 'Sam', role: 'STAFF', active: true };
export const adminUser = { id: 'u2', email: 'ada@test', name: 'Ada', role: 'ADMIN', active: true };
