import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { meQueryKey, useAuth } from '../auth';
import { Button, Field, FormError, Input } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

export function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => api.post<{ user: User }>('/auth/login', { email, password }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(meQueryKey, user);
      navigate('/stock', { replace: true });
    },
  });

  if (user) return <Navigate to="/stock" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  const error = login.error;
  const message =
    error instanceof ApiError
      ? error.code === 'RATE_LIMITED' || error.code === 'INVALID_CREDENTIALS' || error.status === 0
        ? error.message
        : error.code === 'VALIDATION_FAILED'
          ? 'Enter a valid email address and your password.'
          : 'Sign-in failed. Try again.'
      : null;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-base font-semibold">StockPilot</span>
        </div>
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">Sign in</h1>
        <p className="mt-1 text-ink-3">Use the account your administrator gave you.</p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field label="Email">
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <FormError message={message} />
          <Button type="submit" variant="primary" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
