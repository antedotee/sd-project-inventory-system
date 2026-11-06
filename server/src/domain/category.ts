/**
 * Groups products (aggregation): deleting a category does not delete its
 * products; their category is simply cleared (ON DELETE SET NULL).
 */
export class Category {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}
