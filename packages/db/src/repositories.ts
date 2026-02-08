import {
  Prisma,
  UnitType as PrismaUnitType,
  UserAssignmentStatus,
  UserUnitStatus,
} from '@prisma/client';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  AssignmentSummaryDTO,
  AuthUserDTO,
  BookmarkUnitRequest,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  UserUnitStateDTO,
} from '@nephix/contracts';
import { canCompleteUnit, sortAssignmentsByDeadline } from '@nephix/domain';
import prisma from './client';
import {
  fromPrismaAssignmentStatus,
  fromPrismaTaskType,
  fromPrismaUnitStatus,
  fromPrismaUnitType,
  toPrismaUnitStatus,
} from './mappers';

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
export class UnauthorizedTransitionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonToRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || !isRecord(value)) {
    return null;
  }
  return value;
}

function mergeJsonRecord(
  existing: Prisma.JsonValue | null,
  next: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | null | undefined {
  if (!next) {
    return undefined;
  }
  const base = isRecord(existing) ? existing : {};
  return { ...base, ...next } as Prisma.InputJsonValue;
}

function mapAuthUser(user: { id: string; email: string; createdAt: Date }): AuthUserDTO {
  return {
    id: user.id,
    email: user.email,
    createdAtISO: user.createdAt.toISOString(),
  };
}

function mapUnitState(state: {
  unitId: string;
  status: UserUnitStatus;
  bookmarked: boolean;
  content: Prisma.JsonValue | null;
  position: Prisma.JsonValue | null;
  updatedAt: Date;
}): UserUnitStateDTO {
  return {
    unitId: state.unitId,
    status: fromPrismaUnitStatus(state.status),
    bookmarked: state.bookmarked,
    content: jsonToRecord(state.content),
    position: jsonToRecord(state.position),
    updatedAtISO: state.updatedAt.toISOString(),
  };
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function createUser(email: string, passwordHash: string): Promise<AuthUserDTO> {
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
    },
  });
  return mapAuthUser(created);
}

export async function getAuthUserById(id: string): Promise<AuthUserDTO | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return null;
  }
  return mapAuthUser(user);
}

export async function createRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  rotatedFromId?: string,
) {
  return prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      rotatedFromId,
    },
  });
}

export async function getRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

export async function revokeRefreshToken(tokenId: string) {
  return prisma.refreshToken.update({
    where: { id: tokenId },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function revokeAllRefreshTokensForUser(userId: string) {
  return prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function rotateRefreshToken(
  oldTokenId: string,
  userId: string,
  newTokenHash: string,
  newExpiresAt: Date,
) {
  return prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: oldTokenId },
      data: { revokedAt: new Date() },
    });

    return tx.refreshToken.create({
      data: {
        userId,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        rotatedFromId: oldTokenId,
      },
    });
  });
}

export async function listFeedForUser(userId: string): Promise<AssignmentSummaryDTO[]> {
  const assignments = await prisma.assignment.findMany({
    where: { active: true },
    include: {
      units: {
        select: {
          id: true,
        },
      },
      assignmentState: {
        where: { userId },
        take: 1,
      },
    },
  });

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const unitStates = await prisma.userUnitState.findMany({
    where: {
      userId,
      unit: {
        assignmentId: {
          in: assignmentIds,
        },
      },
      status: UserUnitStatus.COMPLETED,
    },
    select: {
      unit: {
        select: {
          assignmentId: true,
        },
      },
    },
  });

  const completedByAssignment = new Map<string, number>();
  for (const state of unitStates) {
    const current = completedByAssignment.get(state.unit.assignmentId) ?? 0;
    completedByAssignment.set(state.unit.assignmentId, current + 1);
  }

  const mapped: AssignmentSummaryDTO[] = assignments.map((assignment) => {
    const currentState = assignment.assignmentState[0] ?? null;
    return {
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      taskType: fromPrismaTaskType(assignment.taskType),
      deadlineISO: assignment.deadline.toISOString(),
      status: currentState
        ? fromPrismaAssignmentStatus(currentState.status)
        : ('not_started' as const),
      currentUnitId: currentState?.currentUnitId ?? null,
      totalUnits: assignment.units.length,
      completedUnits: completedByAssignment.get(assignment.id) ?? 0,
    };
  });

  return sortAssignmentsByDeadline(mapped);
}

export async function getAssignmentDetailById(assignmentId: string): Promise<AssignmentDetailDTO> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      units: {
        orderBy: {
          orderIndex: 'asc',
        },
      },
    },
  });

  if (!assignment || !assignment.active) {
    throw new NotFoundError('Assignment not found.');
  }

  return {
    id: assignment.id,
    title: assignment.title,
    subject: assignment.subject,
    taskType: fromPrismaTaskType(assignment.taskType),
    deadlineISO: assignment.deadline.toISOString(),
    units: assignment.units.map((unit) => ({
      id: unit.id,
      assignmentId: unit.assignmentId,
      orderIndex: unit.orderIndex,
      unitType: fromPrismaUnitType(unit.unitType),
      title: unit.title,
      payload: (jsonToRecord(unit.payload) ?? {}) as Record<string, unknown>,
      targetWords: unit.targetWords,
    })),
  };
}

async function initializeUnitStates(
  userId: string,
  assignmentId: string,
  currentUnitId: string | null,
): Promise<void> {
  const units = await prisma.assignmentUnit.findMany({
    where: { assignmentId },
    orderBy: { orderIndex: 'asc' },
  });

  await prisma.userUnitState.createMany({
    data: units.map((unit) => ({
      userId,
      unitId: unit.id,
      status: unit.id === currentUnitId ? UserUnitStatus.ACTIVE : UserUnitStatus.UNREAD,
    })),
    skipDuplicates: true,
  });

  if (currentUnitId) {
    const currentState = await prisma.userUnitState.findUnique({
      where: {
        userId_unitId: {
          userId,
          unitId: currentUnitId,
        },
      },
    });

    if (currentState && currentState.status === UserUnitStatus.UNREAD) {
      await prisma.userUnitState.update({
        where: {
          userId_unitId: {
            userId,
            unitId: currentUnitId,
          },
        },
        data: {
          status: UserUnitStatus.ACTIVE,
        },
      });
    }
  }
}

async function ensureAssignmentState(userId: string, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      units: {
        orderBy: { orderIndex: 'asc' },
      },
    },
  });

  if (!assignment || !assignment.active) {
    throw new NotFoundError('Assignment not found.');
  }

  let state = await prisma.userAssignmentState.findUnique({
    where: {
      userId_assignmentId: {
        userId,
        assignmentId,
      },
    },
  });

  if (!state) {
    const firstUnitId = assignment.units[0]?.id ?? null;
    state = await prisma.userAssignmentState.create({
      data: {
        userId,
        assignmentId,
        currentUnitId: firstUnitId,
        status: firstUnitId ? UserAssignmentStatus.IN_PROGRESS : UserAssignmentStatus.NOT_STARTED,
        lastOpenedAt: firstUnitId ? new Date() : null,
      },
    });
  }

  await initializeUnitStates(userId, assignmentId, state.currentUnitId);
  return state;
}

export async function getAssignmentStateForUser(
  userId: string,
  assignmentId: string,
): Promise<AssignmentStateDTO> {
  const state = await ensureAssignmentState(userId, assignmentId);

  const unitStates = await prisma.userUnitState.findMany({
    where: {
      userId,
      unit: {
        assignmentId,
      },
    },
    include: {
      unit: {
        select: {
          orderIndex: true,
        },
      },
    },
    orderBy: {
      unit: {
        orderIndex: 'asc',
      },
    },
  });

  return {
    assignmentId,
    status: fromPrismaAssignmentStatus(state.status),
    currentUnitId: state.currentUnitId,
    unitStates: unitStates.map((entry) =>
      mapUnitState({
        unitId: entry.unitId,
        status: entry.status,
        bookmarked: entry.bookmarked,
        content: entry.content,
        position: entry.position,
        updatedAt: entry.updatedAt,
      }),
    ),
  };
}

export async function patchUnitStateForUser(
  userId: string,
  unitId: string,
  data: PatchUnitStateRequest,
): Promise<UserUnitStateDTO> {
  const unit = await prisma.assignmentUnit.findUnique({
    where: { id: unitId },
    select: {
      assignmentId: true,
    },
  });

  if (!unit) {
    throw new NotFoundError('Unit not found.');
  }

  const assignmentState = await ensureAssignmentState(userId, unit.assignmentId);
  const existing = await prisma.userUnitState.findUnique({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
  });

  const nextStatus = data.status
    ? toPrismaUnitStatus(data.status)
    : existing?.status ?? UserUnitStatus.ACTIVE;

  const saved = await prisma.userUnitState.upsert({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
    create: {
      userId,
      unitId,
      status: nextStatus,
      content: mergeJsonRecord(null, data.content),
      position: mergeJsonRecord(null, data.position),
    },
    update: {
      status: nextStatus,
      content: mergeJsonRecord(existing?.content ?? null, data.content),
      position: mergeJsonRecord(existing?.position ?? null, data.position),
    },
  });

  await prisma.userAssignmentState.update({
    where: {
      userId_assignmentId: {
        userId,
        assignmentId: unit.assignmentId,
      },
    },
    data: {
      status: UserAssignmentStatus.IN_PROGRESS,
      lastOpenedAt: new Date(),
      currentUnitId: assignmentState.currentUnitId ?? unitId,
    },
  });

  return mapUnitState({
    unitId: saved.unitId,
    status: saved.status,
    bookmarked: saved.bookmarked,
    content: saved.content,
    position: saved.position,
    updatedAt: saved.updatedAt,
  });
}

export async function completeUnitForUser(
  userId: string,
  unitId: string,
): Promise<CompleteUnitResponse> {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.assignmentUnit.findUnique({
      where: { id: unitId },
      include: {
        assignment: {
          include: {
            units: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    if (!unit || !unit.assignment.active) {
      throw new NotFoundError('Unit not found.');
    }

    let assignmentState = await tx.userAssignmentState.findUnique({
      where: {
        userId_assignmentId: {
          userId,
          assignmentId: unit.assignmentId,
        },
      },
    });

    if (!assignmentState) {
      assignmentState = await tx.userAssignmentState.create({
        data: {
          userId,
          assignmentId: unit.assignmentId,
          currentUnitId: unit.assignment.units[0]?.id ?? null,
          status: UserAssignmentStatus.IN_PROGRESS,
          lastOpenedAt: new Date(),
        },
      });
      await tx.userUnitState.createMany({
        data: unit.assignment.units.map((entry) => ({
          userId,
          unitId: entry.id,
          status:
            entry.id === assignmentState.currentUnitId ? UserUnitStatus.ACTIVE : UserUnitStatus.UNREAD,
        })),
        skipDuplicates: true,
      });
    }

    if (assignmentState.currentUnitId !== unitId) {
      throw new UnauthorizedTransitionError('You can only complete the currently active unit.');
    }

    const currentState = await tx.userUnitState.findUnique({
      where: {
        userId_unitId: {
          userId,
          unitId,
        },
      },
    });

    const completion = canCompleteUnit({
      unitType: fromPrismaUnitType(unit.unitType),
      content: jsonToRecord(currentState?.content ?? null),
    });

    if (!completion.ok) {
      throw new ValidationError(completion.reason ?? 'Unit does not satisfy completion criteria.');
    }

    await tx.userUnitState.upsert({
      where: {
        userId_unitId: {
          userId,
          unitId,
        },
      },
      create: {
        userId,
        unitId,
        status: UserUnitStatus.COMPLETED,
      },
      update: {
        status: UserUnitStatus.COMPLETED,
      },
    });

    const unitStates = await tx.userUnitState.findMany({
      where: {
        userId,
        unit: {
          assignmentId: unit.assignmentId,
        },
      },
      select: {
        unitId: true,
        status: true,
      },
    });

    const completedSet = new Set(
      unitStates
        .filter((entry) => entry.status === UserUnitStatus.COMPLETED)
        .map((entry) => entry.unitId),
    );

    const nextUnit = unit.assignment.units.find(
      (candidate) => candidate.orderIndex > unit.orderIndex && !completedSet.has(candidate.id),
    );

    let nextAssignmentStatus = UserAssignmentStatus.COMPLETED;
    if (nextUnit) {
      nextAssignmentStatus = UserAssignmentStatus.IN_PROGRESS;
      await tx.userUnitState.upsert({
        where: {
          userId_unitId: {
            userId,
            unitId: nextUnit.id,
          },
        },
        create: {
          userId,
          unitId: nextUnit.id,
          status: UserUnitStatus.ACTIVE,
        },
        update: {
          status: UserUnitStatus.ACTIVE,
        },
      });
    }

    await tx.userAssignmentState.update({
      where: {
        userId_assignmentId: {
          userId,
          assignmentId: unit.assignmentId,
        },
      },
      data: {
        status: nextAssignmentStatus,
        currentUnitId: nextUnit?.id ?? null,
        lastOpenedAt: new Date(),
        completedAt: nextUnit ? null : new Date(),
      },
    });

    return {
      completedUnitId: unitId,
      nextUnitId: nextUnit?.id ?? null,
      assignmentStatus:
        nextAssignmentStatus === UserAssignmentStatus.COMPLETED ? 'completed' : 'in_progress',
    };
  });
}

export async function setUnitBookmarkForUser(
  userId: string,
  unitId: string,
  payload: BookmarkUnitRequest,
): Promise<UserUnitStateDTO> {
  const unit = await prisma.assignmentUnit.findUnique({
    where: { id: unitId },
    select: { assignmentId: true },
  });

  if (!unit) {
    throw new NotFoundError('Unit not found.');
  }

  await ensureAssignmentState(userId, unit.assignmentId);

  const existing = await prisma.userUnitState.findUnique({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
  });

  const saved = await prisma.userUnitState.upsert({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
    create: {
      userId,
      unitId,
      bookmarked: payload.bookmarked,
      status: UserUnitStatus.UNREAD,
    },
    update: {
      bookmarked: payload.bookmarked,
      status: existing?.status ?? UserUnitStatus.UNREAD,
    },
  });

  return mapUnitState({
    unitId: saved.unitId,
    status: saved.status,
    bookmarked: saved.bookmarked,
    content: saved.content,
    position: saved.position,
    updatedAt: saved.updatedAt,
  });
}

export async function collectWritingSectionsForAssignment(userId: string, assignmentId: string) {
  const writingUnits = await prisma.assignmentUnit.findMany({
    where: {
      assignmentId,
      unitType: {
        in: [PrismaUnitType.WRITING],
      },
    },
    orderBy: {
      orderIndex: 'asc',
    },
  });

  const states = await prisma.userUnitState.findMany({
    where: {
      userId,
      unitId: {
        in: writingUnits.map((unit) => unit.id),
      },
    },
  });

  const stateMap = new Map(states.map((state) => [state.unitId, state]));

  return writingUnits.map((unit) => {
    const content = jsonToRecord(stateMap.get(unit.id)?.content ?? null) ?? {};
    const text = typeof content.text === 'string' ? content.text : '';
    return {
      title: unit.title,
      text,
      targetWords: unit.targetWords ?? 0,
    };
  });
}
