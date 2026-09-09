import { z } from 'zod';

/** Mirrors apps/api's GET /health — the shallow probe a load balancer polls. */
export const HealthResponseSchema = z.union([
  z.object({ status: z.literal('ok'), db: z.literal('up') }),
  z.object({ status: z.literal('error'), db: z.literal('down') }),
]);
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CheckStatusSchema = z.enum(['up', 'down', 'not_configured']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const HealthCheckSchema = z.object({
  status: CheckStatusSchema,
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

/** Mirrors apps/api's GET /health/deep — per-dependency detail for alerting. */
export const DeepHealthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), HealthCheckSchema),
});
export type DeepHealthReport = z.infer<typeof DeepHealthReportSchema>;
