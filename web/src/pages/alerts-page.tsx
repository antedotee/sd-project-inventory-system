import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
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
import { api, queryString } from '../lib/api';
import { cn, formatCount, formatDateTime } from '../lib/format';
import type { Alert, AlertStatus, Page } from '../lib/types';

const PAGE_SIZE = 20;

export function AlertsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AlertStatus>('OPEN');
  const [page, setPage] = useState(1);

  const alerts = useQuery({
    queryKey: ['alerts', { status, page }],
    queryFn: ({ signal }) => api.get<Page<Alert>>(`/alerts${queryString({ status, page, pageSize: PAGE_SIZE })}`, signal),
    placeholderData: keepPreviousData,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post<Alert>(`/alerts/${id}/acknowledge`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Raised when available stock reaches a product’s reorder point. They close by themselves once stock is received."
      />

      <div role="group" aria-label="Filter by status" className="mb-3 flex gap-1">
        {(['OPEN', 'RESOLVED'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant="ghost"
            aria-pressed={status === s}
            className={cn(status === s && 'bg-shelf text-ink')}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s === 'OPEN' ? 'Open' : 'Resolved'}
          </Button>
        ))}
      </div>

      <Panel>
        {alerts.isPending ? (
          <TableSkeleton columns={5} />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
        ) : alerts.data.items.length === 0 ? (
          status === 'OPEN' ? (
            <EmptyState
              title="Nothing needs reordering"
              description="Every product is above its reorder point."
              action={
                <Link to="/stock" className="font-medium text-ink underline underline-offset-4">
                  View stock
                </Link>
              }
            />
          ) : (
            <EmptyState title="No resolved alerts" description="Alerts move here after stock is replenished." />
          )
        ) : (
          <>
            <MobileList label="Alerts">
              {alerts.data.items.map((a) => (
                <MobileItem key={a.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-ink">{a.productName}</p>
                      <Sku>{a.sku}</Sku>
                    </div>
                    <AlertAction alert={a} pendingId={acknowledge.isPending ? acknowledge.variables : undefined} onAck={(id) => acknowledge.mutate(id)} />
                  </div>
                  <p className="text-[13px] text-ink-3 tabular-nums">
                    {formatCount(a.availableAtTrigger)} available, reorder at {formatCount(a.threshold)} ·{' '}
                    {formatDateTime(a.status === 'OPEN' ? a.createdAt : a.resolvedAt!)}
                  </p>
                </MobileItem>
              ))}
            </MobileList>
            <Table wrapperClassName="hidden md:block">
              <thead>
                <tr>
                  <Th className="w-40">SKU</Th>
                  <Th>Product</Th>
                  <Th numeric>Available then</Th>
                  <Th numeric>Reorder at</Th>
                  <Th>Raised</Th>
                  <Th className="w-40">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {alerts.data.items.map((a) => (
                  <tr key={a.id} className="hover:bg-shelf/40">
                    <Td>
                      <Sku>{a.sku}</Sku>
                    </Td>
                    <Td>{a.productName}</Td>
                    <Td numeric className="font-semibold">
                      {formatCount(a.availableAtTrigger)}
                    </Td>
                    <Td numeric className="text-ink-3">
                      {formatCount(a.threshold)}
                    </Td>
                    <Td className="text-ink-3">{formatDateTime(a.status === 'OPEN' ? a.createdAt : a.resolvedAt!)}</Td>
                    <Td className="text-right">
                      <AlertAction alert={a} pendingId={acknowledge.isPending ? acknowledge.variables : undefined} onAck={(id) => acknowledge.mutate(id)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={alerts.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      {acknowledge.isError && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-stop">
          {acknowledge.error.message}
        </p>
      )}
    </>
  );
}

function AlertAction({ alert, pendingId, onAck }: { alert: Alert; pendingId?: string; onAck: (id: string) => void }) {
  if (alert.status === 'RESOLVED') return <Chip tone="go">Resolved</Chip>;
  if (alert.acknowledgedAt) return <Chip>Seen</Chip>;
  return (
    <Button size="sm" disabled={pendingId === alert.id} onClick={() => onAck(alert.id)}>
      Mark as seen
    </Button>
  );
}
