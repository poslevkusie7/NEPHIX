import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@nephix/contracts', '@nephix/domain', '@nephix/db', '@nephix/ui'],
  serverExternalPackages: ['@prisma/client', 'prisma', '@prisma/engines'],
  outputFileTracingIncludes: {
    // Ensure Prisma engines/client artifacts are copied for serverless runtime on Vercel.
    '/*': [
      '../../node_modules/.prisma/client/**/*',
      '../../node_modules/@prisma/client/**/*',
      '../../node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/**/*',
      '../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*',
      '../../node_modules/.pnpm/@prisma+engines*/node_modules/@prisma/engines/**/*',
    ],
  },
};

export default nextConfig;
