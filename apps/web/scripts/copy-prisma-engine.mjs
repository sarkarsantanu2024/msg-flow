import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy Prisma's native query engine into apps/web/.prisma/client.
 *
 * Prisma resolves its engine at runtime rather than requiring it by a literal
 * path, so Next's output file tracing never discovers the .node binary and the
 * deployed serverless function ships without one. Every query then dies with
 * "could not locate the Query Engine for runtime rhel-openssl-3.0.x".
 *
 * Relying on outputFileTracingIncludes to reach across the workspace into
 * pnpm's content-hashed store worked locally but not on Vercel. Placing the
 * engine inside the app instead means a plain project-relative include covers
 * it — and `<app>/.prisma/client` is already one of the directories Prisma
 * searches, so it is found even if the bundler moves things around.
 *
 * Runs from apps/web's build script, after `prisma generate`.
 */

const webDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(webDir));
const pnpmDir = join(workspaceRoot, 'node_modules', '.pnpm');
const destination = join(webDir, '.prisma', 'client');

if (!existsSync(pnpmDir)) {
  console.error(`[prisma-engine] no pnpm store at ${pnpmDir}`);
  process.exit(1);
}

// pnpm's directory names are content-hashed, so the client package has to be
// found by prefix rather than by a name we can predict.
const sources = readdirSync(pnpmDir)
  .filter((entry) => entry.startsWith('@prisma+client@'))
  .map((entry) => join(pnpmDir, entry, 'node_modules', '.prisma', 'client'))
  .filter((dir) => existsSync(dir));

if (sources.length === 0) {
  console.error('[prisma-engine] no generated client found — did `prisma generate` run?');
  process.exit(1);
}

mkdirSync(destination, { recursive: true });

let copied = 0;
for (const source of sources) {
  for (const file of readdirSync(source)) {
    // The schema travels with the engine: Prisma reads it back at startup.
    if (!file.endsWith('.node') && file !== 'schema.prisma') continue;
    copyFileSync(join(source, file), join(destination, file));
    console.log(`[prisma-engine] copied ${file}`);
    copied += 1;
  }
}

if (copied === 0) {
  console.error('[prisma-engine] client directory held no engine binary');
  process.exit(1);
}
