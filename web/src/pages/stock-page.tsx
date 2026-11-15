import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Modal } from '../components/dialogs';
import { StockGauge } from '../components/stock-gauge';
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
  Sku,
  Table,
  TableSkeleton,
  Td,
  Th,
} from '../components/ui';
import { api, ApiError, fieldErrors, queryString } from '../lib/api';
import { formatCount, formatDateTime, formatDelta } from '../lib/format';
import type { Movement, Page, StockChange, StockRow } from '../lib/types';
import { useDebounced } from '../lib/use-debounced';

const PAGE_SIZE = 25;

type Action = { kind: 'receive' | 'adjust' | 'history'; row: StockRow } | null;

export function StockPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action>(null);
  const search = useDebounced(q);

  const stock = useQuery({
    queryKey: ['stock', { search, lowOnly, page }],
    queryFn: ({ signal }) =>
      api.get<Page<StockRow>>(`/stock${queryString({ q: search, lowOnly: lowOnly || undefined, page, pageSize: PAGE_SIZE })}`, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Stock" description="What is on the shelf, what is promised, and what can still be sold." />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Search stock by name or SKU"
          placeholder="Search name or SKU…"
          autoComplete="off"
          spellCheck={false}
          className="w-full sm:w-72"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-ink-2 hover:bg-shelf">
          <input
            type="checkbox"
            className="size-4 accent-ink"
            checked={lowOnly}
            onChange={(e) => {
              setLowOnly(e.target.checked);
              setPage(1);
            }}
          />
          Low stock only
        </label>
      </div>

      <Panel>
        {stock.isPending ? (
          <TableSkeleton columns={6} />
        ) : stock.isError ? (
          <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
        ) : stock.data.items.length === 0 ? (
          lowOnly || search ? (
            <EmptyState
              title="Nothing matches"
              description={lowOnly ? 'No product is at or below its reorder point.' : `No product matches “${search}”.`}
              action={
                <Button
                  onClick={() => {
                    setQ('');
                    setLowOnly(false);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No products yet"
              description="Stock appears here once an admin adds products."
            />
          )
        ) : (
          <>
            <MobileList label="Stock" className="lg:hidden">
              {stock.data.items.map((row) => (
                <MobileItem key={row.productId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        <span className="break-words">{row.name}</span>
                        {row.low && <Chip tone="attention">Low</Chip>}
                      </p>
                      <Sku>{row.sku}</Sku>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="text-lg leading-6 font-semibold text-ink">{formatCount(row.available)}</p>
                      <p className="text-xs text-ink-3">available</p>
                    </div>
                  </div>
                  <StockGauge onHand={row.onHand} reserved={row.reserved} threshold={row.threshold} low={row.low} />
                  <p className="text-[13px] text-ink-3 tabular-nums">
                    On hand {formatCount(row.onHand)} · reserved {formatCount(row.reserved)} · reorder at{' '}
                    {formatCount(row.threshold)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setAction({ kind: 'receive', row })}>
                      Receive
                    </Button>
                    {can('ADMIN') && (
                      <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'adjust', row })}>
                        Adjust
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'history', row })}>
                      History
                    </Button>
                  </div>
                </MobileItem>
              ))}
            </MobileList>
            <Table wrapperClassName="hidden lg:block">
              <thead>
                <tr>
                  <Th className="w-40">SKU</Th>
                  <Th>Product</Th>
                  <Th className="w-44">
                    <span className="sr-only">Stock gauge</span>
                  </Th>
                  <Th numeric className="w-24">
                    On hand
                  </Th>
                  <Th numeric className="w-24">
                    Reserved
                  </Th>
                  <Th numeric className="w-32">
                    Available
                  </Th>
                  <Th className="w-56">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {stock.data.items.map((row) => (
                  <tr key={row.productId} className="hover:bg-shelf/40">
                    <Td>
                      <Sku>{row.sku}</Sku>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="truncate">{row.name}</span>
                        {row.low && <Chip tone="attention">Low</Chip>}
                      </span>
                    </Td>
                    <Td>
                      <StockGauge onHand={row.onHand} reserved={row.reserved} threshold={row.threshold} low={row.low} />
                    </Td>
                    <Td numeric className="text-ink-3">
                      {formatCount(row.onHand)}
                    </Td>
                    <Td numeric className="text-ink-3">
                      {formatCount(row.reserved)}
                    </Td>
                    <Td numeric>
                      <span className="font-semibold text-ink">{formatCount(row.available)}</span>
                      <span className="block text-xs whitespace-nowrap text-ink-4">reorder at {formatCount(row.threshold)}</span>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'history', row })}>
                          History
                        </Button>
                        {can('ADMIN') && (
                          <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'adjust', row })}>
                            Adjust
                          </Button>
                        )}
                        <Button size="sm" onClick={() => setAction({ kind: 'receive', row })}>
                          Receive
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={stock.data.total} onPage={setPage} />
          </>
        )}
      </Panel>

      {action && action.kind !== 'history' && (
        <StockChangeDialog kind={action.kind} row={action.row} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'history' && <HistoryDialog row={action.row} onClose={() => setAction(null)} />}
    </>
  );
}

function StockChangeDialog({ kind, row, onClose }: { kind: 'receive' | 'adjust'; row: StockRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const isReceive = kind === 'receive';

  const change = useMutation({
    mutationFn: () =>
      isReceive
        ? api.post<StockChange>('/stock/receipts', { productId: row.productId, quantity: Number(amount), note: text || undefined })
        : api.post<StockChange>('/stock/adjustments', { productId: row.productId, delta: Number(amount), reason: text }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['movements', row.productId] });
      onClose();
    },
  });

  const errors = fieldErrors(change.error);
  const formError =
    change.error instanceof ApiError && change.error.code !== 'VALIDATION_FAILED' ? change.error.message : null;
  const [submitted, setSubmitted] = useState(false);
  const amountValid = /^-?\d+$/.test(amount.trim()) && Number(amount) !== 0 && (!isReceive || Number(amount) > 0);
  const reasonValid = isReceive || text.trim().length >= 3;
  const amountError = (submitted || amount) && !amountValid ? `Enter a whole number${isReceive ? ' above 0' : ', not 0'}` : undefined;
  const reasonError = submitted && !reasonValid ? 'Give a reason of at least 3 characters' : undefined;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (amountValid && reasonValid) change.mutate();
  };

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={isReceive ? `Receive ${row.name}` : `Adjust ${row.name}`}
      description={
        isReceive
          ? 'Record stock that arrived. It becomes available immediately.'
          : 'Correct the on-hand count (stock take, damage, loss). Use a negative number to remove stock.'
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-[13px] text-ink-3 tabular-nums">
          On hand {formatCount(row.onHand)} · reserved {formatCount(row.reserved)} · available {formatCount(row.available)}
        </p>
        <Field
          label={isReceive ? 'Quantity received' : 'Change (+ or −)'}
          error={errors.quantity ?? errors.delta ?? amountError}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field label={isReceive ? 'Note (optional)' : 'Reason'} error={errors.reason ?? errors.note ?? reasonError} hint={isReceive ? 'e.g. delivery reference' : 'Required, e.g. “damaged in storage”'}>
          {(p) => <Input {...p} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <FormError message={formError} />
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={change.isPending}>
            {change.isPending ? 'Saving…' : isReceive ? 'Record receipt' : 'Save adjustment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const MOVEMENT_LABEL: Record<Movement['type'], string> = {
  RECEIPT: 'Receipt',
  SALE: 'Sale',
  ADJUSTMENT: 'Adjustment',
};

function HistoryDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['movements', row.productId, page],
    queryFn: ({ signal }) => api.get<Page<Movement>>(`/stock/${row.productId}/movements${queryString({ page, pageSize: 15 })}`, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`History · ${row.name}`} description="Every change to on-hand stock, newest first. Entries are permanent." width={640}>
      {history.isPending ? (
        <TableSkeleton columns={4} rows={5} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data.items.length === 0 ? (
        <EmptyState title="No movements yet" description="Receive stock to start the history." />
      ) : (
        <div className="-mx-6">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th>Reason / reference</Th>
                <Th numeric>Change</Th>
              </tr>
            </thead>
            <tbody>
              {history.data.items.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap text-ink-3">{formatDateTime(m.createdAt)}</Td>
                  <Td>{MOVEMENT_LABEL[m.type]}</Td>
                  <Td className="text-ink-3">{m.reason ?? (m.reference.type === 'ORDER' ? 'Order shipped' : '—')}</Td>
                  <Td numeric className={m.delta > 0 ? 'font-medium text-go' : 'font-medium text-ink'}>
                    {formatDelta(m.delta)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={15} total={history.data.total} onPage={setPage} />
        </div>
      )}
    </Modal>
  );
}
