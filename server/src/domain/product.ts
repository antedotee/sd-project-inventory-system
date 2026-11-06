import { ValidationError } from './errors';
import { newId } from './id';
import { FixedThresholdPolicy, type ReorderPolicy } from './reorder-policy';

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

/**
 * A sellable item. Immutable: changes go through ProductBuilder.from(product),
 * which re-checks every invariant, so an invalid Product can never exist.
 */
export class Product {
  constructor(
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
}

/**
 * BUILDER pattern: Product has many fields, several optional, plus rules
 * that span fields. The builder gives readable construction
 * (`new ProductBuilder().sku('A-1').name('Bolt').build()`) and validates
 * everything once in build().
 */
export class ProductBuilder {
  private _id = newId();
  private _sku?: string;
  private _name?: string;
  private _description = '';
  private _categoryId: string | null = null;
  private _unitPriceCents = 0;
  private _reorderPolicy: ReorderPolicy = new FixedThresholdPolicy(0);
  private _active = true;
  private _version = 1;
  private _createdAt = new Date();
  private _updatedAt = new Date();

  /** Start from an existing product, e.g. to apply an edit. */
  static from(product: Product): ProductBuilder {
    const b = new ProductBuilder();
    b._id = product.id;
    b._sku = product.sku;
    b._name = product.name;
    b._description = product.description;
    b._categoryId = product.categoryId;
    b._unitPriceCents = product.unitPriceCents;
    b._reorderPolicy = product.reorderPolicy;
    b._active = product.active;
    b._version = product.version;
    b._createdAt = product.createdAt;
    b._updatedAt = product.updatedAt;
    return b;
  }

  id(id: string) {
    this._id = id;
    return this;
  }
  sku(sku: string) {
    this._sku = sku.trim().toUpperCase();
    return this;
  }
  name(name: string) {
    this._name = name.trim();
    return this;
  }
  description(description: string) {
    this._description = description.trim();
    return this;
  }
  category(categoryId: string | null) {
    this._categoryId = categoryId;
    return this;
  }
  unitPriceCents(cents: number) {
    this._unitPriceCents = cents;
    return this;
  }
  reorderPolicy(policy: ReorderPolicy) {
    this._reorderPolicy = policy;
    return this;
  }
  active(active: boolean) {
    this._active = active;
    return this;
  }
  version(version: number) {
    this._version = version;
    return this;
  }
  timestamps(createdAt: Date, updatedAt: Date) {
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    return this;
  }

  build(): Product {
    const problems: Record<string, string> = {};
    if (!this._sku || !SKU_PATTERN.test(this._sku)) {
      problems.sku = 'SKU must be 2-40 characters: A-Z, 0-9 and dashes';
    }
    if (!this._name || this._name.length > 120) problems.name = 'Name is required (max 120 characters)';
    if (this._description.length > 2000) problems.description = 'Description is too long (max 2000)';
    if (!Number.isInteger(this._unitPriceCents) || this._unitPriceCents < 0) {
      problems.unitPriceCents = 'Price must be a non-negative whole number of cents';
    }
    if (Object.keys(problems).length > 0) {
      throw new ValidationError('Product is invalid', { fields: problems });
    }
    return new Product(
      this._id,
      this._sku!,
      this._name!,
      this._description,
      this._categoryId,
      this._unitPriceCents,
      this._reorderPolicy,
      this._active,
      this._version,
      this._createdAt,
      this._updatedAt,
    );
  }
}
