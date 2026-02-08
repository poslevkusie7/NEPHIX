import {
  AssignmentTaskType,
  UnitType as PrismaUnitType,
  UserAssignmentStatus,
  UserUnitStatus,
} from '@prisma/client';
import type { AssignmentStatus, TaskType, UnitStatus, UnitType } from '@nephix/contracts';

export function toPrismaTaskType(value: TaskType): AssignmentTaskType {
  return value === 'reading' ? AssignmentTaskType.READING : AssignmentTaskType.ESSAY;
}

export function fromPrismaTaskType(value: AssignmentTaskType): TaskType {
  return value === AssignmentTaskType.READING ? 'reading' : 'essay';
}

export function toPrismaUnitType(value: UnitType): PrismaUnitType {
  switch (value) {
    case 'reading':
      return PrismaUnitType.READING;
    case 'thesis':
      return PrismaUnitType.THESIS;
    case 'outline':
      return PrismaUnitType.OUTLINE;
    case 'writing':
      return PrismaUnitType.WRITING;
    case 'revise':
      return PrismaUnitType.REVISE;
  }
}

export function fromPrismaUnitType(value: PrismaUnitType): UnitType {
  switch (value) {
    case PrismaUnitType.READING:
      return 'reading';
    case PrismaUnitType.THESIS:
      return 'thesis';
    case PrismaUnitType.OUTLINE:
      return 'outline';
    case PrismaUnitType.WRITING:
      return 'writing';
    case PrismaUnitType.REVISE:
      return 'revise';
  }
}

export function fromPrismaAssignmentStatus(value: UserAssignmentStatus): AssignmentStatus {
  switch (value) {
    case UserAssignmentStatus.NOT_STARTED:
      return 'not_started';
    case UserAssignmentStatus.IN_PROGRESS:
      return 'in_progress';
    case UserAssignmentStatus.COMPLETED:
      return 'completed';
  }
}

export function toPrismaUnitStatus(value: UnitStatus): UserUnitStatus {
  switch (value) {
    case 'unread':
      return UserUnitStatus.UNREAD;
    case 'active':
      return UserUnitStatus.ACTIVE;
    case 'completed':
      return UserUnitStatus.COMPLETED;
  }
}

export function fromPrismaUnitStatus(value: UserUnitStatus): UnitStatus {
  switch (value) {
    case UserUnitStatus.UNREAD:
      return 'unread';
    case UserUnitStatus.ACTIVE:
      return 'active';
    case UserUnitStatus.COMPLETED:
      return 'completed';
  }
}
