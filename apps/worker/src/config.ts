import "dotenv/config";
import { z } from "zod";

/**
 * Worker configuration.
 *
 * The worker is deliberately independent of the web app's environment schema —
 * it has no database URL and no AI keys. All it needs is where to post messages
 * and the shared secret to authenticate with.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Where the Next.js app lives — the worker POSTs messages here. */
  APP_URL: z.string().url().default("https://msg-flow.vercel.app"),
  WHATSAPP_WORKER_SECRET: z
    .string()
    .min(1, "WHATSAPP_WORKER_SECRET is required"),

  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WORKER_NAME: z.string().default(`worker-${process.pid}`),
  WORKER_SESSION_PATH: z.string().default("./.sessions"),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5_000).default(15_000),

  /**
   * Opt-in capture marker. Only messages containing this tag (case-insensitive)
   * are forwarded to the app — the sender decides what enters the pipeline by
   * tagging it, so no chat is ever swept wholesale.
   */
  CAPTURE_TAG: z.string().default("@get"),

  PUPPETEER_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

  /** How often the worker asks the app to run due automations. */
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(30_000).default(60_000),
  /** Set to false to let an external scheduler drive /api/cron/tick instead. */
  SCHEDULER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse({
  ...process.env,
  WHATSAPP_WORKER_SECRET:
    process.env.WHATSAPP_WORKER_SECRET || "dev-only-worker-secret",
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid worker configuration:\n${issues}\n\nSee .env.example.`,
  );
}

export const config = parsed.data;
