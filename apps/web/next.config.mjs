/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nephix/contracts', '@nephix/domain', '@nephix/db', '@nephix/ui'],
};

export default nextConfig;
