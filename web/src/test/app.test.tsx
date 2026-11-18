import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { navItemsFor, Sidebar } from '../components/app-shell';
import { LoginPage } from '../pages/login-page';
import { NewOrderDialog } from '../pages/orders-page';
import { ProductDialog } from '../pages/products-page';
import type { Product } from '../lib/types';
import { adminUser, json, mockFetch, renderWithProviders, staffUser } from './utils';

const P1 = '11111111-1111-7111-8111-111111111111';
const stockPage = {
  items: [{ productId: P1, sku: 'BOLT-1', name: 'Bolt', onHand: 5, reserved: 0, available: 5, threshold: 1, low: false }],
  page: 1,
  pageSize: 100,
  total: 1,
};

describe('login', () => {
  test('shows the server message next to the form on bad credentials', async () => {
    mockFetch({
      'GET /auth/me': () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }),
      'POST /auth/login': () => json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }),
    });
    renderWithProviders(<LoginPage />, '/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'sam@test.local');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });
});

describe('role-aware navigation', () => {
  test('Products is an admin-only item', () => {
    expect(navItemsFor('STAFF').map((i) => i.label)).toEqual(['Stock', 'Orders', 'Alerts']);
    expect(navItemsFor('ADMIN').map((i) => i.label)).toContain('Products');
  });

  test('the sidebar shows a STAFF user only what they can use, with the open-alert badge', async () => {
    mockFetch({
      'GET /auth/me': () => json(200, { user: staffUser }),
      'GET /alerts/open-count': () => json(200, { open: 3 }),
    });
    renderWithProviders(<Sidebar />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByText('Products')).not.toBeInTheDocument();
    expect(await within(nav).findByLabelText('3 open alerts')).toBeInTheDocument();
  });

  test('an ADMIN sees Products', async () => {
    mockFetch({
      'GET /auth/me': () => json(200, { user: adminUser }),
      'GET /alerts/open-count': () => json(200, { open: 0 }),
    });
    renderWithProviders(<Sidebar />);
    expect(await screen.findByRole('link', { name: 'Products' })).toBeInTheDocument();
  });
});

describe('placing an order', () => {
  async function fillOrder(quantity: string) {
    const select = await screen.findByLabelText('Product, line 1');
    await waitFor(() => expect(select).not.toBeDisabled());
    await userEvent.selectOptions(select, P1);
    const qty = screen.getByLabelText('Quantity');
    await userEvent.clear(qty);
    await userEvent.type(qty, quantity);
  }

  test('a network error is shown, and pressing again places the order', async () => {
    let attempt = 0;
    mockFetch({
      'GET /auth/me': () => json(200, { user: staffUser }),
      'GET /stock': () => json(200, stockPage),
      'POST /orders': () =>
        ++attempt === 1
          ? 'network-error'
          : json(201, { id: 'o1', number: 'SO-1', status: 'RESERVED', totalCents: 0, lines: [], allowedActions: {} }),
    });
    let created = false;
    renderWithProviders(<NewOrderDialog onClose={() => {}} onCreated={() => (created = true)} />);
    await fillOrder('2');

    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(created).toBe(true));
  });

  test('INSUFFICIENT_STOCK (409) is shown on the line it concerns', async () => {
    mockFetch({
      'GET /auth/me': () => json(200, { user: staffUser }),
      'GET /stock': () => json(200, stockPage),
      'POST /orders': () =>
        json(409, {
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 'Only 1 available, 2 requested',
            details: { productId: P1, requested: 2, available: 1 },
          },
        }),
    });
    renderWithProviders(<NewOrderDialog onClose={() => {}} onCreated={() => {}} />);
    await fillOrder('2');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    const select = screen.getByLabelText('Product, line 1');
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Only 1 available')).toBeInTheDocument();
  });
});

describe('editing a product', () => {
  const product: Product = {
    id: 'p1',
    sku: 'BOLT-1',
    name: 'Bolt',
    description: '',
    categoryId: null,
    unitPriceCents: 125,
    reorderPolicy: { kind: 'FIXED', reorderPoint: 5 },
    reorderThreshold: 5,
    active: true,
    version: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  test('a stale version (409 VERSION_CONFLICT) opens the reload dialog, and reload loads the latest', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => json(200, { user: adminUser }),
      'PATCH /products/p1': () =>
        json(409, { error: { code: 'VERSION_CONFLICT', message: 'Product p1 was changed by someone else.' } }),
      'GET /products/p1': () => json(200, { ...product, name: 'Bolt (renamed)', version: 4 }),
    });
    renderWithProviders(<ProductDialog product={product} categories={[]} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));

    const conflict = await screen.findByRole('alertdialog');
    expect(conflict).toHaveTextContent('This product changed while you were editing');
    expect((calls.find((c) => c.method === 'PATCH')!.body as { version: number }).version).toBe(3);

    await userEvent.click(within(conflict).getByRole('button', { name: 'Load latest version' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Bolt (renamed)'));
  });
});
