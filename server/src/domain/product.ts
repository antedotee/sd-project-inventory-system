import { ValidationError } from './errors';
import { newId } from './id';
import { FixedThresholdPolicy, type ReorderPolicy } from './reorder-policy';

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

export interface ProductFields {
  id?: string;
  sku: string;
  name: string;
  description?: string;
  categoryId?: string | null;
  unitPriceCents?: number;
  reorderPolicy?: ReorderPolicy;
  active?: boolean;
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * A sellable item. Immutable. `create` and `with` re-check every invariant,
 * so an invalid Product can never exist.
 */
export class Product {
  private constructor(
    readonly id: string,
    readonly sku: string,
    readonly name: string,
    readonly description: string,
    readonly categoryId: string | null,
    readonly unitPriceCents: number,
    readonly reorderPolicy: ReorderPolicy,
    readonly active: boolean,
    readonly version: number,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  /** Delegates to the Strategy chosen for this product. */
  isLowOnStock(available: number): boolean {
    return this.reorderPolicy.shouldAlert(available);
  }

  static create(fields: ProductFields): Product {
    const sku = fields.sku.trim().toUpperCase();
    const name = fields.name.trim();
    const description = (fields.description ?? '').trim();
    const unitPriceCents = fields.unitPriceCents ?? 0;
    const problems: Record<string, string> = {};
    if (!SKU_PATTERN.test(sku)) problems.sku = 'SKU must be 2-40 characters: A-Z, 0-9 and dashes';
    if (!name || name.length > 120) problems.name = 'Name is required (max 120 characters)';
    if (description.length > 2000) problems.description = 'Description is too long (max 2000)';
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      problems.unitPriceCents = 'Price must be a non-negative whole number of cents';
    }
    if (Object.keys(problems).length > 0) {
      throw new ValidationError('Product is invalid', { fields: problems });
    }
    return new Product(
      fields.id ?? newId(),
      sku,
      name,
      description,
      fields.categoryId ?? null,
      unitPriceCents,
      fields.reorderPolicy ?? new FixedThresholdPolicy(0),
      fields.active ?? true,
      fields.version ?? 1,
      fields.createdAt ?? new Date(),
      fields.updatedAt ?? new Date(),
    );
  }

  /** Copy with a patch. Undefined fields stay as they are. Re-validates. */
  with(patch: Partial<ProductFields>): Product {
    return Product.create({
      id: this.id,
      sku: patch.sku ?? this.sku,
      name: patch.name ?? this.name,
      description: patch.description ?? this.description,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : this.categoryId,
      unitPriceCents: patch.unitPriceCents ?? this.unitPriceCents,
      reorderPolicy: patch.reorderPolicy ?? this.reorderPolicy,
      active: patch.active ?? this.active,
      version: patch.version ?? this.version,
      createdAt: patch.createdAt ?? this.createdAt,
      updatedAt: patch.updatedAt ?? this.updatedAt,
    });
  }
}
