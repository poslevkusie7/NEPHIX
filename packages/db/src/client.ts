import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { PrismaClient } from './prisma-runtime';

declare global {
  // eslint-disable-next-line no-var
  var __nephixPrisma: PrismaClientType | undefined;
}

const prisma = global.__nephixPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__nephixPrisma = prisma;
}

export default prisma;
