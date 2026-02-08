import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __nephixPrisma: PrismaClient | undefined;
}

const prisma = global.__nephixPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__nephixPrisma = prisma;
}

export default prisma;
