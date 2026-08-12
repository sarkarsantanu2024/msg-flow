import { NextResponse } from 'next/server';
import { getSystemHealth } from '@msgflow/workflow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public health endpoint for uptime monitors and container orchestrators.
 *
 * Unauthenticated by design, so it deliberately exposes only layer states and
 * short messages — never counts, tenant names, or connection details.
 */
export async function GET() {
  try {
    const health = await getSystemHealth();
    const status = health.overall === 'DOWN' ? 503 : 200;

    return NextResponse.json(
      {
        status: health.overall,
        checkedAt: health.checkedAt,
        layers: health.layers.map((l) => ({ layer: l.layer, state: l.state })),
        version: process.env.npm_package_version ?? '1.0.0',
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: 'DOWN',
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Health check failed',
      },
      { status: 503 },
    );
  }
}
