import { Category } from '../domain/category';
import { NotFoundError, VersionConflictError } from '../domain/errors';
import { newId } from '../domain/id';
import { Product } from '../domain/product';
import { type ReorderPolicyConfig, reorderPolicyFrom } from '../domain/reorder-policy';
import { StockLevel } from '../domain/stock-level';
import type { Page, PageRequest } from './pagination';
import type { TransactionRunner } from './ports';
import type { CategoryRepository, ProductFilter, ProductRepository } from './repositories';

export interface ProductInput {
  sku: string;
  name: string;
  description?: string;
  categoryId?: string | null;
  unitPriceCents: number;
  reorderPolicy: ReorderPolicyConfig;
}

export type ProductPatch = Partial<Omit<ProductInput, 'sku'>>;

export class CategoryService {
  constructor(private readonly categories: CategoryRepository) {}

  list(): Promise<Category[]> {
    return this.categories.list();
  }

  /** Uniqueness is enforced by the repository (unique index), which throws DuplicateError. */
  create(name: string): Promise<Category> {
    return this.categories.create(new Category(newId(), name.trim()));
  }
}

export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly tx: TransactionRunner,
  ) {}

  search(filter: ProductFilter, page: PageRequest): Promise<Page<Product>> {
    return this.products.search(filter, page);
  }

  async get(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  /** Creates the product and its (empty) stock level in one transaction. */
  async create(input: ProductInput): Promise<Product> {
    await this.assertCategoryExists(input.categoryId);
    const product = Product.create({
      sku: input.sku,
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      unitPriceCents: input.unitPriceCents,
      reorderPolicy: reorderPolicyFrom(input.reorderPolicy),
    });

    return this.tx.run(async (uow) => {
      const saved = await uow.products.create(product);
      await uow.stockLevels.create(new StockLevel(saved.id, 0, 0, 1));
      return saved;
    });
  }

  /** Optimistic locking: the caller sends the version it last saw. */
  async update(id: string, patch: ProductPatch, expectedVersion: number): Promise<Product> {
    const current = await this.get(id);
    if (current.version !== expectedVersion) throw new VersionConflictError('Product', id);
    if (patch.categoryId !== undefined) await this.assertCategoryExists(patch.categoryId);

    const saved = await this.products.update(
      current.with({
        name: patch.name,
        description: patch.description,
        categoryId: patch.categoryId,
        unitPriceCents: patch.unitPriceCents,
        reorderPolicy: patch.reorderPolicy && reorderPolicyFrom(patch.reorderPolicy),
      }),
      expectedVersion,
    );
    if (!saved) throw new VersionConflictError('Product', id);
    return saved;
  }

  /** Soft delete: order history and the ledger keep pointing at the product. */
  async deactivate(id: string): Promise<Product> {
    const current = await this.get(id);
    const saved = await this.products.update(current.with({ active: false }), current.version);
    if (!saved) throw new VersionConflictError('Product', id);
    return saved;
  }

  private async assertCategoryExists(categoryId: string | null | undefined) {
    if (categoryId && !(await this.categories.findById(categoryId))) {
      throw new NotFoundError('Category', categoryId);
    }
  }
}
