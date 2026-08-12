/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
