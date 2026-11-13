import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, setUnauthorizedHandler } from './lib/api';
import type { Role, User } from './lib/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  can: (...roles: Role[]) => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
export const meQueryKey = ['auth', 'me'] as const;

async function fetchMe(): Promise<User | null> {
  try {
    return (await api.get<{ user: User }>('/auth/me')).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });

  useEffect(() => {
    // A 401 anywhere means the session ended (expired, logged out elsewhere, deactivated).
    setUnauthorizedHandler(() => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
      navigate('/login', { replace: true });
    });
  }, [queryClient, navigate]);

  const logout = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
      navigate('/login', { replace: true });
    },
  });

  const user = me.data ?? null;
  const value: AuthState = {
    user,
    loading: me.isPending,
    can: (...roles) => !!user && roles.includes(user.role),
    logout: async () => {
      await logout.mutateAsync().catch(() => {});
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
