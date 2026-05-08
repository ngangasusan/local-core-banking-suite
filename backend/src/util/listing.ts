// Shared list/paging/search helpers.
import { z } from "zod";

export const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().trim().max(50).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListQueryT = z.infer<typeof ListQuery>;

/** Build "ORDER BY <col> <dir>" only if `sort` is in the allow-list. */
export function safeOrderBy(
  q: ListQueryT,
  allowed: readonly string[],
  defaultCol: string
): string {
  const col = q.sort && allowed.includes(q.sort) ? q.sort : defaultCol;
  return `ORDER BY ${col} ${q.order.toUpperCase()}`;
}

export function pageLimits(q: ListQueryT): { limit: number; offset: number } {
  return { limit: q.limit, offset: q.offset };
}
