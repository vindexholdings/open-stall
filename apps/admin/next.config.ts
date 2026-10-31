import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source.
  transpilePackages: ['@open-stall/ui', '@open-stall/domain'],
  poweredByHeader: false,
};

export default nextConfig;
