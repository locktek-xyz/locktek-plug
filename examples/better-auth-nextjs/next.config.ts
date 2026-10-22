import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Without this, Next walks up past the repo and picks whatever lockfile it finds
  // first — on a developer machine that can be their home directory.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default nextConfig;
