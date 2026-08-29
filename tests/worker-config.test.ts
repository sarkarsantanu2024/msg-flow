import { describe, expect, it } from 'vitest';
import { checkWorkerConfig, type ServerEnv } from '@msgflow/config';

/**
 * Regression guard for the deployment mistake that took WhatsApp down in
 * production: a hosted web app whose WHATSAPP_WORKER_URL still pointed at
 * localhost. Every connection button failed, including Logout, and the health
 * report blamed a stopped worker rather than naming the real cause.
 */

function env(app: string, worker: string): ServerEnv {
  return { APP_URL: app, WHATSAPP_WORKER_URL: worker } as ServerEnv;
}

describe('checkWorkerConfig', () => {
  it('rejects a hosted app pointing at localhost', () => {
    const result = checkWorkerConfig(env('https://msg-flow.vercel.app', 'http://localhost:4000'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('localhost is the server itself');
      expect(result.reason).toContain('https://msg-flow.vercel.app');
    }
  });

  it.each(['http://127.0.0.1:4000', 'http://[::1]:4000', 'http://127.1.2.3:4000'])(
    'rejects the loopback address %s',
    (worker) => {
      expect(checkWorkerConfig(env('https://app.example.com', worker)).ok).toBe(false);
    },
  );

  it('accepts a fully local development setup', () => {
    expect(checkWorkerConfig(env('http://localhost:3000', 'http://localhost:4000')).ok).toBe(true);
  });

  it('accepts a hosted app pointing at a hosted worker', () => {
    expect(
      checkWorkerConfig(env('https://msg-flow.vercel.app', 'https://worker.up.railway.app')).ok,
    ).toBe(true);
  });

  it('accepts a hosted worker reached by private hostname', () => {
    // Docker/Fly service names are not loopback and must not be flagged.
    expect(checkWorkerConfig(env('https://app.example.com', 'http://msgflow-worker:4000')).ok).toBe(true);
  });

  it('rejects a value that is not a URL at all', () => {
    const result = checkWorkerConfig(env('https://app.example.com', 'worker.example.com:4000'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not a valid URL');
  });
});
