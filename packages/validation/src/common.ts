import { z } from 'zod';

export const cuidSchema = z.string().min(1, 'Required');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const datePresetSchema = z.enum([
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'custom',
]);

export const dateRangeQuerySchema = z
  .object({
    preset: datePresetSchema.default('last7'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((v) => v.preset !== 'custom' || (v.from && v.to), {
    message: 'A custom range requires both `from` and `to`.',
    path: ['from'],
  });

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

/**
 * Parse `URLSearchParams` with a Zod object schema.
 * Repeated keys collapse into arrays so `?category=A&category=B` works.
 */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, params: URLSearchParams): z.infer<T> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key).filter((v) => v !== '');
    if (all.length === 0) continue;
    raw[key] = all.length > 1 ? all : all[0];
  }
  return schema.parse(raw);
}

/** Flatten a ZodError into `{ field: message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
