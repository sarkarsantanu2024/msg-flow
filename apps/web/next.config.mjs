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

  logging: {
    fetches: { fullUrl: false },
  },
};

export default nextConfig;
