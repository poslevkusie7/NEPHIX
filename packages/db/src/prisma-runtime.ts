import prismaClientPkg from '@prisma/client';
import type * as PrismaClientExports from '@prisma/client';

const runtime = prismaClientPkg as typeof PrismaClientExports;

export const {
  AssignmentTaskType,
  PrismaClient,
  ScheduleGoalType,
  ScheduleItemStatus,
  UnitType,
  UserInteractionEventType,
  UserAssignmentStatus,
  UserUnitStatus,
} = runtime;
