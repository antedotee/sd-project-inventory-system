import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ConfirmDialog, Modal } from '../components/dialogs';
import {
  Button,
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
  Textarea,
  Th,
} from '../components/ui';
import { api, ApiError, fieldErrors, queryString } from '../lib/api';
import { formatCount, formatMoney, parseMoneyToCents } from '../lib/format';
import type { Category, Page, Product, ReorderPolicy } from '../lib/types';
import { useDebounced } from '../lib/use-debounced';

const PAGE_SIZE = 25;

function describePolicy(p: ReorderPolicy) {
  return p.kind === 'FIXED' ? `At ${formatCount(p.reorderPoint)}` : `${p.percent}% of ${formatCount(p.maxStock)}`;
}

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [removing, setRemoving] = useState<Product | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const search = useDebounced(q);

  const products = useQuery({
    queryKey: ['products', { search, page }],
    queryFn: ({ signal }) => api.get<Page<Product>>(`/products${queryString({ q: search, page, pageSize: PAGE_SIZE })}`, signal),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => api.get<{ items: Category[] }>('/categories', signal),
  });
  const categoryName = new Map(categories.data?.items.map((c) => [c.id, c.name]));

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete<Product>(`/products/${id}`),
    onSuccess: () => {
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Products"
        description="The catalogue, prices and reorder rules."
        actions={
          <>
            <Button onClick={() => setAddingCategory(true)}>New category</Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              New product
            </Button>
          </>
        }
      />

      <div className="mb-3">
        <Input
          type="search"
          aria-label="Search products by name or SKU"
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
      </div>

      <Panel>
        {products.isPending ? (
          <TableSkeleton columns={5} />
        ) : products.isError ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : products.data.items.length === 0 ? (
          search ? (
            <EmptyState title="Nothing matches" description={`No product matches “${search}”.`} action={<Button onClick={() => setQ('')}>Clear search</Button>} />
          ) : (
            <EmptyState
              title="No products yet"
              description="Add your first product to start tracking its stock."
              action={
                <Button variant="primary" onClick={() => setEditing('new')}>
                  New product
                </Button>
              }
            />
          )
        ) : (
          <>
            <MobileList label="Products">
              {products.data.items.map((p) => (
                <MobileItem key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words text-ink">{p.name}</p>
                      <Sku>{p.sku}</Sku>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{formatMoney(p.unitPriceCents)}</span>
                  </div>
                  <p className="text-[13px] text-ink-3">
                    {p.categoryId ? categoryName.get(p.categoryId) : 'No category'} · reorder {describePolicy(p.reorderPolicy).toLowerCase()}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                      Deactivate
                    </Button>
                  </div>
                </MobileItem>
              ))}
            </MobileList>
            <Table wrapperClassName="hidden md:block">
              <thead>
                <tr>
                  <Th className="w-40">SKU</Th>
                  <Th>Name</Th>
                  <Th>Category</Th>
                  <Th numeric>Price</Th>
                  <Th>Reorder</Th>
                  <Th className="w-44">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((p) => (
                  <tr key={p.id} className="hover:bg-shelf/40">
                    <Td>
                      <Sku>{p.sku}</Sku>
                    </Td>
                    <Td className="font-medium">{p.name}</Td>
                    <Td className="text-ink-3">{p.categoryId ? categoryName.get(p.categoryId) : '—'}</Td>
                    <Td numeric>{formatMoney(p.unitPriceCents)}</Td>
                    <Td className="text-ink-3">{describePolicy(p.reorderPolicy)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                          Deactivate
                        </Button>
                        <Button size="sm" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={setPage} />
          </>
        )}
      </Panel>

      {editing && (
        <ProductDialog product={editing === 'new' ? null : editing} categories={categories.data?.items ?? []} onClose={() => setEditing(null)} />
      )}
      {addingCategory && <CategoryDialog onClose={() => setAddingCategory(false)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Deactivate ${removing?.name ?? ''}?`}
        description="It disappears from stock and new orders. Its history and past orders are kept."
        confirmLabel="Deactivate"
        pending={deactivate.isPending}
        error={deactivate.error?.message}
        onConfirm={() => removing && deactivate.mutate(removing.id)}
      />
    </>
  );
}

/* Create / edit ---------------------------------------------------------------- */

interface FormState {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  price: string;
  policyKind: ReorderPolicy['kind'];
  reorderPoint: string;
  maxStock: string;
  percent: string;
}

function toForm(p: Product | null): FormState {
  const policy = p?.reorderPolicy;
  return {
    sku: p?.sku ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    categoryId: p?.categoryId ?? '',
    price: p ? (p.unitPriceCents / 100).toFixed(2) : '',
    policyKind: policy?.kind ?? 'FIXED',
    reorderPoint: policy?.kind === 'FIXED' ? String(policy.reorderPoint) : '10',
    maxStock: policy?.kind === 'PERCENT_OF_MAX' ? String(policy.maxStock) : '100',
    percent: policy?.kind === 'PERCENT_OF_MAX' ? String(policy.percent) : '20',
  };
}

function toPolicy(f: FormState): ReorderPolicy {
  return f.policyKind === 'FIXED'
    ? { kind: 'FIXED', reorderPoint: Number(f.reorderPoint) }
    : { kind: 'PERCENT_OF_MAX', maxStock: Number(f.maxStock), percent: Number(f.percent) };
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'VERSION_CONFLICT';
}

export function ProductDialog({ product, categories, onClose }: { product: Product | null; categories: Category[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(product);
  const [form, setForm] = useState(() => toForm(product));
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const isNew = !current;

  const save = useMutation({
    mutationFn: () => {
      const cents = parseMoneyToCents(form.price);
      const body = {
        name: form.name,
        description: form.description,
        categoryId: form.categoryId || null,
        unitPriceCents: cents ?? -1,
        reorderPolicy: toPolicy(form),
      };
      return isNew
        ? api.post<Product>('/products', { ...body, sku: form.sku })
        : api.patch<Product>(`/products/${current.id}`, { ...body, version: current.version });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
  });

  const reload = useMutation({
    mutationFn: () => api.get<Product>(`/products/${current!.id}`),
    onSuccess: (latest) => {
      setCurrent(latest);
      setForm(toForm(latest));
      save.reset();
    },
  });

  const errors = fieldErrors(save.error);
  const conflict = isVersionConflict(save.error);
  const formError = save.error instanceof ApiError && save.error.code !== 'VALIDATION_FAILED' && !conflict ? save.error.message : null;
  const [submitted, setSubmitted] = useState(false);
  const priceValid = parseMoneyToCents(form.price) !== null;
  const priceError = (submitted || form.price) && !priceValid ? 'Enter a price like 12.50' : errors.unitPriceCents;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (priceValid) save.mutate();
  };

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={isNew ? 'New product' : `Edit ${current.name}`} width={560}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU" error={errors.sku} hint={isNew ? 'Letters, digits and dashes' : 'SKUs cannot change'}>
            {(p) => <Input {...p} className="font-mono uppercase" value={form.sku} disabled={!isNew} onChange={(e) => set({ sku: e.target.value })} />}
          </Field>
          <Field label="Price" error={priceError}>
            {(p) => <Input {...p} inputMode="decimal" className="tabular-nums" placeholder="0.00" value={form.price} onChange={(e) => set({ price: e.target.value })} />}
          </Field>
        </div>
        <Field label="Name" error={errors.name}>
          {(p) => <Input {...p} value={form.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label="Category" error={errors.categoryId}>
          {(p) => (
            <Select {...p} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" error={errors.description}>
          {(p) => <Textarea {...p} value={form.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>

        <fieldset className="flex flex-col gap-3 rounded-md bg-paper p-4 shadow-[inset_0_0_0_1px_var(--color-rule)]">
          <legend className="sr-only">Reorder rule</legend>
          <Field label="Reorder rule" hint="When available stock reaches this level, an alert is raised.">
            {(p) => (
              <Select {...p} value={form.policyKind} onChange={(e) => set({ policyKind: e.target.value as ReorderPolicy['kind'] })}>
                <option value="FIXED">Fixed quantity</option>
                <option value="PERCENT_OF_MAX">Percentage of a full shelf</option>
              </Select>
            )}
          </Field>
          {form.policyKind === 'FIXED' ? (
            <Field label="Reorder at" error={errors['reorderPolicy.reorderPoint']}>
              {(p) => <Input {...p} inputMode="numeric" className="tabular-nums" value={form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} />}
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full shelf quantity" error={errors['reorderPolicy.maxStock']}>
                {(p) => <Input {...p} inputMode="numeric" className="tabular-nums" value={form.maxStock} onChange={(e) => set({ maxStock: e.target.value })} />}
              </Field>
              <Field label="Reorder at (%)" error={errors['reorderPolicy.percent']}>
                {(p) => <Input {...p} inputMode="numeric" className="tabular-nums" value={form.percent} onChange={(e) => set({ percent: e.target.value })} />}
              </Field>
            </div>
          )}
        </fieldset>

        <FormError message={formError} />
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={conflict}
        onOpenChange={(open) => !open && save.reset()}
        tone="primary"
        title="This product changed while you were editing"
        description="Someone else saved a newer version. Load it to see their changes, then make your edit again."
        confirmLabel="Load latest version"
        pending={reload.isPending}
        error={reload.error?.message}
        onConfirm={() => reload.mutate()}
      />
    </Modal>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Category>('/categories', { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });
  const error = fieldErrors(create.error).name ?? (create.error instanceof ApiError ? create.error.message : undefined);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="New category" width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field label="Name" error={error}>
          {(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Create category
          </Button>
        </div>
      </form>
    </Modal>
  );
}
