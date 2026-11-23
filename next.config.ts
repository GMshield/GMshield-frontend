import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server for the production image (Dockerfile): it writes nothing outside /tmp.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Images are self-hosted and served as they are: no optimizer writing a cache on disk.
  images: { unoptimized: true },
  // No development indicator: `next dev` puts it under the page, which adds 46px of scrolling to every screen that
  // fills the window and so hides what the layout really does. Compile and runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
