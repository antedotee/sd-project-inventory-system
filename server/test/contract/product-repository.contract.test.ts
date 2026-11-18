import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProductRepository } from '../../src/application/repositories';
import { DuplicateError } from '../../src/domain/errors';
import { Product } from '../../src/domain/product';
import { InMemoryProductRepository } from '../../src/infrastructure/memory/in-memory-repositories';
import { DrizzleProductRepository } from '../../src/infrastructure/repositories/catalog-repositories';
import { makeTestApp, resetDb } from '../helpers';

/**
 * LISKOV SUBSTITUTION, proven: one suite, two implementations. Anything a
 * service relies on must behave identically in both.
 */
const ctx = makeTestApp();

const implementations: [string, () => Promise<ProductRepository>][] = [
  ['InMemoryProductRepository', async () => new InMemoryProductRepository()],
  [
    'DrizzleProductRepository',
    async () => {
      await resetDb(ctx);
      return new DrizzleProductRepository(ctx.container.database.db);
    },
  ],
];

const product = (sku: string, name: string) => Product.create({ sku, name, unitPriceCents: 100 });

for (const [label, make] of implementations) {
  describe(`ProductRepository contract: ${label}`, () => {
    let repo: ProductRepository;
    beforeEach(async () => {
      repo = await make();
    });

    test('create then findById returns an equal product', async () => {
      const p = product('BOLT-1', 'Bolt');
      await repo.create(p);
      const found = await repo.findById(p.id);
      expect(found?.sku).toBe('BOLT-1');
      expect(found?.version).toBe(1);
    });

    test('duplicate SKU throws DuplicateError', async () => {
      await repo.create(product('DUP-1', 'A'));
      await expect(repo.create(product('DUP-1', 'B'))).rejects.toBeInstanceOf(DuplicateError);
    });

    test('update with the current version bumps it; a stale version returns null', async () => {
      const p = await repo.create(product('VER-1', 'Old'));
      const updated = await repo.update(p.with({ name: 'New' }), 1);
      expect(updated?.version).toBe(2);
      expect(updated?.name).toBe('New');
      expect(await repo.update(p.with({ name: 'Stale' }), 1)).toBeNull();
    });

    test('search filters by text, hides inactive, sorts by name and paginates', async () => {
      await repo.create(product('C-1', 'Cable'));
      await repo.create(product('A-1', 'Anchor'));
      const hidden = await repo.create(product('B-1', 'Bracket'));
      await repo.update(hidden.with({ active: false }), 1);

      const all = await repo.search({}, { page: 1, pageSize: 10 });
      expect(all.items.map((p) => p.name)).toEqual(['Anchor', 'Cable']);
      expect(all.total).toBe(2);

      const page2 = await repo.search({}, { page: 2, pageSize: 1 });
      expect(page2.items.map((p) => p.name)).toEqual(['Cable']);

      const byText = await repo.search({ q: 'cab' }, { page: 1, pageSize: 10 });
      expect(byText.items.map((p) => p.sku)).toEqual(['C-1']);
    });

    test('findManyByIds ignores unknown ids', async () => {
      const p = await repo.create(product('M-1', 'Many'));
      const found = await repo.findManyByIds([p.id, '00000000-0000-7000-8000-000000000000']);
      expect(found.map((x) => x.id)).toEqual([p.id]);
    });
  });
}
