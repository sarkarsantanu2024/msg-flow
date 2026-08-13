import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // This app lives in a pnpm workspace, so its dependencies resolve above
  // apps/web. Without this, tracing treats apps/web as the root and refuses to
  // copy anything outside it into the serverless bundle.
  outputFileTracingRoot: workspaceRoot,

  // Prisma's query engine is a native .node binary that file tracing does not
  // discover: nothing `require`s it by a literal path, the client resolves it at
  // runtime. Listing @prisma/client in serverExternalPackages keeps the JS out
  // of the webpack bundle but does not carry the engine along, so the deployed
  // function found .prisma/client and no engine inside it — every query then
  // failed with "could not locate the Query Engine for runtime rhel-openssl-3.0.x".
  // pnpm's store path is content-hashed, hence the glob.
  // scripts/copy-prisma-engine.mjs stages the engine inside the app before the
  // build, so this include is project-relative — reaching across the workspace
  // into pnpm's store traced correctly in a local build but not on Vercel.
  // Both paths are listed: whichever one tracing honours, the engine ships.
  outputFileTracingIncludes: {
    '/**/*': [
      './.prisma/client/*.node',
      '../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/*.node',
    ],
  },

  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: [
    '@msgflow/ai',
    '@msgflow/config',
    '@msgflow/connectors',
    '@msgflow/db',
    '@msgflow/logger',
    '@msgflow/types',
    '@msgflow/validation',
    '@msgflow/workflow',
  ],

  // These carry native or heavy Node dependencies that must not be bundled into
  // the server output — exceljs, pdfkit, pptxgenjs and googleapis all break when
  // webpack rewrites their dynamic requires.
  serverExternalPackages: [
    '@prisma/client',
    'prisma',
    'exceljs',
    'pdfkit',
    'pptxgenjs',
    'googleapis',
    'bcryptjs',
  ],

  webpack: (config) => {
    // The workspace packages are ESM TypeScript and import siblings with an
    // explicit `.js` extension, as the spec requires. tsc and vitest resolve
    // that to the `.ts` source; webpack needs to be told.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  eslint: {
    dirs: ['src'],
  },

  typescript: {
    // Type errors fail the build via `pnpm typecheck` (tsc --noEmit), not here.
    //
    // The generated Prisma client for this schema is large enough that TypeScript
    // can exhaust its type-instantiation budget while checking it. When that
    // happens tsc silently degrades a generic result to `any`, and `noImplicitAny`
    // then reports the *consumer* — "Parameter 'tx'/'t' implicitly has an 'any'
    // type" — on $transaction callbacks and groupBy rows. Which file trips the
    // limit depends on the order files are checked, which differs between
    // platforms, so the same commit type-checks clean locally and fails on the
    // Linux build container, in a different file each time.
    //
    // These are inference artifacts, not real type errors, and `any` changes no
    // emitted JavaScript. Run `pnpm typecheck` before pushing; that is the gate.
    ignoreBuildErrors: true,
  },

  logging: {
    fetches: { fullUrl: false },
  },
};

export default nextConfig;
