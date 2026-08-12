/**
 * Test environment.
 *
 * Everything here runs without a database or network: the suite covers pure
 * logic — normalization, dedupe hashing, validation, window maths, the Excel
 * connector against real in-memory workbooks, mapping strategies and
 * permissions. Database-backed integration tests belong in a separate suite
 * with a live Postgres instance (see docs/troubleshooting.md).
 */

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'error';
process.env.ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy0hIQ==';
process.env.AUTH_SECRET = 'test-auth-secret-value-for-vitest-runs';
process.env.WHATSAPP_WORKER_SECRET = 'test-worker-secret';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/msgflow_test';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = './.test-storage';
