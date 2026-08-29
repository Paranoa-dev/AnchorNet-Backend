/**
 * Generic sort helper for in-memory list endpoints.
 */

import { ApiError } from "../errors/ApiError";

export interface SortQuery {
  sort?: unknown;
  order?: unknown;
}

interface SortSpec {
  field: string;
  direction: number;
}

function parseSortSpecs(query: SortQuery, allowedFields: readonly string[]): SortSpec[] {
  const sortInput = String(query.sort);
  const fields = sortInput.split(",").map((f) => f.trim());

  for (const field of fields) {
    if (!allowedFields.includes(field)) {
      throw ApiError.badRequest(
        `"sort" must be one of: ${allowedFields.join(", ")}`,
      );
    }
  }

  const orderInput = query.order === undefined ? "" : String(query.order);
  const orders = orderInput
    ? orderInput.split(",").map((o) => o.trim())
    : [];

  if (orders.length > 0 && orders.length !== fields.length) {
    throw ApiError.badRequest(
      `"order" must have the same number of values as "sort"`,
    );
  }

  for (const order of orders) {
    if (order !== "asc" && order !== "desc") {
      throw ApiError.badRequest('"order" must be "asc" or "desc"');
    }
  }

  return fields.map((field, i) => ({
    field,
    direction: orders.length === 0 || (orders[i] ?? "asc") === "asc" ? 1 : -1,
  }));
}

/**
 * Sorts a copy of `items` by the field(s) named in `query.sort`, restricted to
 * `allowedFields`. `query.order` selects `"asc"` (default) or `"desc"`.
 * Supports comma-separated multi-field sorts (e.g. `?sort=status,createdAt`
 * with `?order=asc,desc`). Returns `items` unchanged when no `sort` is given.
 * Throws a 400 for an unknown field or an `order` other than `"asc"`/`"desc"`.
 */
export function applySort<T>(
  items: T[],
  query: SortQuery,
  allowedFields: readonly string[],
): T[] {
  if (query.sort === undefined) {
    return items;
  }

  const specs = parseSortSpecs(query, allowedFields);

  return [...items].sort((a, b) => {
    for (const { field, direction } of specs) {
      const av = (a as Record<string, unknown>)[field];
      const bv = (b as Record<string, unknown>)[field];

      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else if (typeof av === "bigint" && typeof bv === "bigint") {
        cmp = av < bv ? -1 : (av > bv ? 1 : 0);
      } else if (field === "amount" || field === "fee") {
        const aBig = BigInt(av as any);
        const bBig = BigInt(bv as any);
        cmp = aBig < bBig ? -1 : (aBig > bBig ? 1 : 0);
      } else {
        cmp = String(av).localeCompare(String(bv));
      }

      if (cmp !== 0) {
        return cmp * direction;
      }
    }
    return 0;
  });
}
