export interface PageRequest {
  page: number; // 1-based
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function offsetOf(req: PageRequest): number {
  return (req.page - 1) * req.pageSize;
}
