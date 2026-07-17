import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Next auto-loads .env from this app's own directory, not the monorepo root,
// and the root file is the single place a reviewer configures. Load it here so
// process.env.BACKEND_URL is populated in the Next server process (next dev and
// next start alike) for the /api route handlers. The path is resolved from this
// module rather than cwd, and real environment variables still win.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @rif/shared is published as raw TypeScript source, so Next must transpile it.
  transpilePackages: ['@rif/shared'],
};

export default nextConfig;
