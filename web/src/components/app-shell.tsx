import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet } from 'react-router';
import { useAuth } from '../auth';
import { api } from '../lib/api';
import { cn } from '../lib/format';
import type { Role } from '../lib/types';
import { Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

/** Role-aware navigation: an item is only shown to roles that can use it. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/stock', label: 'Stock', roles: ['ADMIN', 'STAFF'] },
  { to: '/orders', label: 'Orders', roles: ['ADMIN', 'STAFF'] },
  { to: '/alerts', label: 'Alerts', roles: ['ADMIN', 'STAFF'] },
  { to: '/products', label: 'Products', roles: ['ADMIN'] },
];

export function navItemsFor(role: Role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function useOpenAlertCount(enabled: boolean) {
  return useQuery({
    queryKey: ['alerts', 'open-count'],
    queryFn: () => api.get<{ open: number }>('/alerts/open-count'),
    enabled,
    refetchInterval: 60_000,
  });
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" width={24} height={24} className="size-6" />
      <span className="font-semibold text-ink" translate="no">
        StockPilot
      </span>
    </div>
  );
}

/** The same links in both layouts; only the arrangement differs. */
function NavLinks({ layout }: { layout: 'column' | 'row' }) {
  const { user } = useAuth();
  const openAlerts = useOpenAlertCount(!!user);
  if (!user) return null;
  return (
    <nav
      aria-label="Main"
      className={cn(layout === 'column' ? 'flex flex-col gap-0.5' : 'flex gap-1 overflow-x-auto [scrollbar-width:none]')}
    >
      {navItemsFor(user.role).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              'flex shrink-0 items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-shelf hover:text-ink',
              layout === 'column' ? 'h-9 justify-between' : 'h-10 px-3',
              isActive && 'bg-shelf font-medium text-ink',
            )
          }
        >
          {item.label}
          {item.to === '/alerts' && !!openAlerts.data?.open && (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-amber px-1.5 text-xs font-semibold text-ink tabular-nums"
              aria-label={`${openAlerts.data.open} open alerts`}
            >
              {openAlerts.data.open}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Below 768px: brand and sign-out on one row, the sections as tabs underneath. */
export function MobileHeader() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <header className="border-b border-rule px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:hidden">
      <div className="flex items-center justify-between pb-2">
        <Brand />
        <Button variant="ghost" size="sm" className="-mr-2" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
      <NavLinks layout="row" />
    </header>
  );
}

export function Sidebar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-rule px-3 py-5 md:flex">
      <div className="px-2 pb-6">
        <Brand />
      </div>

      <NavLinks layout="column" />

      <div className="mt-auto border-t border-rule px-2 pt-4">
        <p className="truncate font-medium text-ink">{user.name}</p>
        <p className="truncate text-xs text-ink-3">
          {user.email} · {user.role === 'ADMIN' ? 'Admin' : 'Staff'}
        </p>
        <Button variant="ghost" size="sm" className="mt-3 -ml-3" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}

export function AppShell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div role="status" className="grid h-dvh place-items-center text-ink-3">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-ink px-3 py-2 text-sheet focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <MobileHeader />
      <Sidebar />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto focus:outline-none">
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8 md:pt-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** Guards an ADMIN-only page. Server-side checks still apply; this is UX. */
export function RequireRole({ role, children }: { role: Role; children: React.ReactNode }) {
  const { can } = useAuth();
  return can(role) ? <>{children}</> : <Navigate to="/stock" replace />;
}
