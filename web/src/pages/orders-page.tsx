import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { ConfirmDialog, Modal } from '../components/dialogs';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  MobileItem,
  MobileList,
  PageHeader,
  Pagination,
  Panel,
  Select,
  Sku,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '../components/ui';
import { api, ApiError, fieldErrors, queryString } from '../lib/api';
import { cn, formatCount, formatDateTime, formatMoney } from '../lib/format';
import type { Order, OrderStatus, OrderSummary, Page, StockRow } from '../lib/types';

const PAGE_SIZE = 20;
const MAX_LINE_QTY = 10_000; // matches the server's placeOrderBody schema
const FILTERS: { value: OrderStatus | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'FULFILLED', label: 'Fulfilled' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const STATUS_CHIP: Record<OrderStatus, { tone: 'attention' | 'go' | 'neutral'; label: string }> = {
  RESERVED: { tone: 'attention', label: 'Reserved' },
  FULFILLED: { tone: 'go', label: 'Fulfilled' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

export function OrdersPage() {
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['orders', { status, page }],
    queryFn: ({ signal }) => api.get<Page<OrderSummary>>(`/orders${queryString({ status, page, pageSize: PAGE_SIZE })}`, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Orders"
        description="Placing an order reserves stock. Fulfil when it ships, or cancel to release it."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New order
          </Button>
        }
      />

      <div role="group" aria-label="Filter by status" className="mb-3 flex gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant="ghost"
            aria-pressed={status === f.value}
            className={cn(status === f.value && 'bg-shelf text-ink')}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Panel>
        {orders.isPending ? (
          <TableSkeleton columns={5} />
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
        ) : orders.data.items.length === 0 ? (
          <EmptyState
            title={status ? 'No orders with this status' : 'No orders yet'}
            description="Orders you place appear here with their reservation status."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New order
              </Button>
            }
          />
        ) : (
          <>
            <MobileList label="Orders">
              {orders.data.items.map((o) => (
                <MobileItem key={o.id}>
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="font-mono text-[13px] font-medium text-ink underline decoration-rule-strong underline-offset-4"
                      onClick={() => setOpenId(o.id)}
                    >
                      {o.number}
                    </button>
                    <Chip tone={STATUS_CHIP[o.status].tone}>{STATUS_CHIP[o.status].label}</Chip>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-[13px] text-ink-3">
                    <span>
                      {formatDateTime(o.createdAt)} · {o.lineCount} {o.lineCount === 1 ? 'line' : 'lines'}
                    </span>
                    <span className="text-sm font-medium text-ink tabular-nums">{formatMoney(o.totalCents)}</span>
                  </div>
                </MobileItem>
              ))}
            </MobileList>
            <Table wrapperClassName="hidden md:block">
              <thead>
                <tr>
                  <Th className="w-36">Order</Th>
                  <Th>Placed</Th>
                  <Th numeric>Lines</Th>
                  <Th numeric>Total</Th>
                  <Th className="w-32">Status</Th>
                </tr>
              </thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-shelf/40">
                    <Td>
                      <button
                        type="button"
                        className="font-mono text-[13px] font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
                        onClick={() => setOpenId(o.id)}
                      >
                        {o.number}
                      </button>
                    </Td>
                    <Td className="text-ink-3">{formatDateTime(o.createdAt)}</Td>
                    <Td numeric>{o.lineCount}</Td>
                    <Td numeric className="font-medium">
                      {formatMoney(o.totalCents)}
                    </Td>
                    <Td>
                      <Chip tone={STATUS_CHIP[o.status].tone}>{STATUS_CHIP[o.status].label}</Chip>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data.total} onPage={setPage} />
          </>
        )}
      </Panel>

      {creating && (
        <NewOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            setOpenId(order.id);
          }}
        />
      )}
      {openId && <OrderDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/* New order ---------------------------------------------------------------- */

interface DraftLine {
  key: number;
  productId: string;
  quantity: string;
}

/** Maps an INSUFFICIENT_STOCK answer onto the order line it is about. */
export function lineErrorFor(error: unknown, productId: string): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'INSUFFICIENT_STOCK') return undefined;
  const d = error.details as { productId?: string; available?: number } | undefined;
  return d?.productId === productId ? `Only ${formatCount(d.available ?? 0)} available` : undefined;
}

export function NewOrderDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (order: Order) => void }) {
  const queryClient = useQueryClient();
  const nextKey = useRef(1);
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, productId: '', quantity: '1' }]);
  const [submitted, setSubmitted] = useState(false);

  const stock = useQuery({
    queryKey: ['stock', 'for-order'],
    queryFn: ({ signal }) => api.get<Page<StockRow>>('/stock?pageSize=100', signal),
  });
  const byId = new Map(stock.data?.items.map((r) => [r.productId, r]));

  const place = useMutation({
    mutationFn: (payload: { lines: { productId: string; quantity: number }[] }) => api.post<Order>('/orders', payload),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      onCreated(order);
    },
  });

  const lineProblem = (l: DraftLine): string | undefined => {
    if (!l.productId) return 'Choose a product';
    if (!/^\d+$/.test(l.quantity) || Number(l.quantity) < 1) return 'Enter a quantity of at least 1';
    if (Number(l.quantity) > MAX_LINE_QTY) return `At most ${formatCount(MAX_LINE_QTY)} per line`;
    const row = byId.get(l.productId);
    if (row && Number(l.quantity) > row.available) return `Only ${formatCount(row.available)} available`;
    if (lines.filter((o) => o.productId === l.productId).length > 1) return 'This product is already on the order';
    return undefined;
  };

  const update = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (lines.some(lineProblem)) return;
    place.mutate({ lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })) });
  };

  const err = place.error;
  const formError =
    err instanceof ApiError && err.code !== 'INSUFFICIENT_STOCK' && err.code !== 'VALIDATION_FAILED' ? err.message : null;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="New order" description="Stock is reserved as soon as the order is placed." width={620}>
      {stock.isError ? (
        <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <ul className="flex flex-col gap-3">
            {lines.map((line, i) => {
              const row = byId.get(line.productId);
              const serverFields = fieldErrors(err);
              const error =
                lineErrorFor(err, line.productId) ??
                serverFields[`lines.${i}.quantity`] ??
                serverFields[`lines.${i}.productId`] ??
                (submitted ? lineProblem(line) : undefined);
              return (
                <li key={line.key} className="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-3 sm:grid-cols-[1fr_7rem_auto]">
                  <Field label={`Product, line ${i + 1}`} error={error} className="col-span-2 sm:col-span-1">
                    {(p) => (
                      <Select {...p} value={line.productId} disabled={stock.isPending} onChange={(e) => update(line.key, { productId: e.target.value })}>
                        <option value="">{stock.isPending ? 'Loading products…' : 'Choose a product'}</option>
                        {stock.data?.items.map((r) => (
                          <option key={r.productId} value={r.productId} disabled={r.available === 0}>
                            {r.sku} · {r.name} ({formatCount(r.available)} available)
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Quantity" hint={row ? `of ${formatCount(row.available)}` : undefined}>
                    {(p) => (
                      <Input {...p} inputMode="numeric" className="tabular-nums" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                    )}
                  </Field>
                  <Button
                    variant="ghost"
                    className="mt-6"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length === 1}
                    title={lines.length === 1 ? 'An order needs at least one line' : undefined}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { key: nextKey.current++, productId: '', quantity: '1' }])}>
              Add line
            </Button>
          </div>
          <FormError message={formError} />
          <div className="flex justify-end gap-2 border-t border-rule pt-4">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={place.isPending}>
              {place.isPending ? 'Placing…' : 'Place order'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* Order details -------------------------------------------------------------- */

function OrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const order = useQuery({ queryKey: ['orders', 'detail', id], queryFn: ({ signal }) => api.get<Order>(`/orders/${id}`, signal) });

  const act = useMutation({
    mutationFn: (action: 'fulfil' | 'cancel') => api.post<Order>(`/orders/${id}/${action}`),
    onSuccess: () => {
      setConfirmCancel(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  const actError = act.error instanceof Error ? act.error.message : null;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={order.data ? `Order ${order.data.number}` : 'Order'} width={620}>
      {order.isPending ? (
        <TableSkeleton columns={4} rows={3} />
      ) : order.isError ? (
        <ErrorState error={order.error} onRetry={() => void order.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-[13px] text-ink-3">
            <span>Placed {formatDateTime(order.data.createdAt)}</span>
            <Chip tone={STATUS_CHIP[order.data.status].tone}>{STATUS_CHIP[order.data.status].label}</Chip>
          </div>
          <div className="-mx-6">
            <Table>
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th numeric>Qty</Th>
                  <Th numeric>Unit</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {order.data.lines.map((l) => (
                  <tr key={l.productId}>
                    <Td>
                      <span className="block">{l.name}</span>
                      <Sku>{l.sku}</Sku>
                    </Td>
                    <Td numeric>{formatCount(l.quantity)}</Td>
                    <Td numeric className="text-ink-3">{formatMoney(l.unitPriceCents)}</Td>
                    <Td numeric>{formatMoney(l.totalCents)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td colSpan={3} className="border-b-0 text-right font-medium text-ink-2">
                    Order total
                  </Td>
                  <Td numeric className="border-b-0 text-base font-semibold">
                    {formatMoney(order.data.totalCents)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          </div>
          {!confirmCancel && <FormError message={actError} />}
          {(order.data.allowedActions.fulfil || order.data.allowedActions.cancel) && (
            <div className="flex justify-end gap-2 border-t border-rule pt-4">
              {order.data.allowedActions.cancel && (
                <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                  Cancel order
                </Button>
              )}
              {order.data.allowedActions.fulfil && (
                <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate('fulfil')}>
                  {act.isPending ? 'Working…' : 'Mark as shipped'}
                </Button>
              )}
            </div>
          )}
          <ConfirmDialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title={`Cancel ${order.data.number}?`}
            description="The reserved stock goes back to available. This cannot be undone."
            confirmLabel="Cancel order"
            pending={act.isPending}
            error={confirmCancel ? actError : null}
            onConfirm={() => act.mutate('cancel')}
          />
        </div>
      )}
    </Modal>
  );
}
