import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server for the production image (Dockerfile): it writes nothing outside /tmp.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Images are self-hosted and served as they are: no optimizer writing a cache on disk.
  images: { unoptimized: true },
};

export default nextConfig;
