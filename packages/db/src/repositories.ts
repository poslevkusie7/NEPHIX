import type {
  Prisma,
  UnitType as PrismaUnitTypeValue,
  ScheduleGoalType as PrismaScheduleGoalType,
  ScheduleItemStatus as PrismaScheduleItemStatus,
  UserInteractionEventType as PrismaUserInteractionEventType,
  UserAssignmentStatus as PrismaUserAssignmentStatus,
  UserUnitStatus as PrismaUserUnitStatus,
} from '@prisma/client';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  AssignmentSummaryDTO,
  AuthUserDTO,
  BookmarkedReadingUnitDTO,
  BookmarkUnitRequest,
  ClarificationTurn,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  ScheduleGoal,
  ThesisSuggestion,
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
import {
  ScheduleGoalType,
  ScheduleItemStatus,
  UnitType as PrismaUnitType,
  UserInteractionEventType,
  UserAssignmentStatus,
  UserUnitStatus,
} from './prisma-runtime';

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
): Prisma.InputJsonValue | undefined {
  if (!next) {
    return undefined;
  }
  const base = isRecord(existing) ? existing : {};
  return { ...base, ...next } as Prisma.InputJsonValue;
}

function buildPreviewFromText(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return 'Open bookmark';
  }

  const preview = words.slice(0, 3).join(' ');
  return words.length > 3 ? `${preview}...` : preview;
}

function mapAuthUser(user: { id: string; email: string; createdAt: Date }): AuthUserDTO {
  return {
    id: user.id,
    email: user.email,
    createdAtISO: user.createdAt.toISOString(),
  };
}

function toEffectiveStatus(status: PrismaUserUnitStatus, bookmarked: boolean): UserUnitStateDTO['effectiveStatus'] {
  if (bookmarked) {
    return 'bookmarked';
  }
  return fromPrismaUnitStatus(status);
}

function toInteractionEventType(
  value:
    | 'unit_opened'
    | 'unit_completed'
    | 'bookmark_toggled'
    | 'chat_used'
    | 'hint_used'
    | 'issue_postponed'
    | 'issue_resolved',
): PrismaUserInteractionEventType {
  switch (value) {
    case 'unit_opened':
      return UserInteractionEventType.UNIT_OPENED;
    case 'unit_completed':
      return UserInteractionEventType.UNIT_COMPLETED;
    case 'bookmark_toggled':
      return UserInteractionEventType.BOOKMARK_TOGGLED;
    case 'chat_used':
      return UserInteractionEventType.CHAT_USED;
    case 'hint_used':
      return UserInteractionEventType.HINT_USED;
    case 'issue_postponed':
      return UserInteractionEventType.ISSUE_POSTPONED;
    case 'issue_resolved':
      return UserInteractionEventType.ISSUE_RESOLVED;
  }
}

function toScheduleGoalType(
  value: 'sources' | 'thesis' | 'outline' | 'writing' | 'revise',
): PrismaScheduleGoalType {
  switch (value) {
    case 'sources':
      return ScheduleGoalType.SOURCES;
    case 'thesis':
      return ScheduleGoalType.THESIS;
    case 'outline':
      return ScheduleGoalType.OUTLINE;
    case 'writing':
      return ScheduleGoalType.WRITING;
    case 'revise':
      return ScheduleGoalType.REVISE;
  }
}

function fromScheduleGoalType(value: PrismaScheduleGoalType): ScheduleGoal['goalType'] {
  switch (value) {
    case ScheduleGoalType.SOURCES:
      return 'sources';
    case ScheduleGoalType.THESIS:
      return 'thesis';
    case ScheduleGoalType.OUTLINE:
      return 'outline';
    case ScheduleGoalType.WRITING:
      return 'writing';
    case ScheduleGoalType.REVISE:
      return 'revise';
  }
}

function fromScheduleItemStatus(value: PrismaScheduleItemStatus): ScheduleGoal['status'] {
  switch (value) {
    case ScheduleItemStatus.PENDING:
      return 'pending';
    case ScheduleItemStatus.DONE:
      return 'done';
    case ScheduleItemStatus.SKIPPED:
      return 'skipped';
  }
}

function getContentConfirmed(content: Prisma.JsonValue | null | undefined): boolean {
  const record = jsonToRecord(content ?? null);
  return Boolean(record?.confirmed);
}

type UnitRowForWarnings = {
  id: string;
  unitType: PrismaUnitTypeValue;
  orderIndex: number;
};

function buildReadinessWarningsForUnit(
  unit: UnitRowForWarnings,
  assignmentUnits: UnitRowForWarnings[],
  stateByUnitId: Map<string, { status: PrismaUserUnitStatus; content: Prisma.JsonValue | null }>,
): string[] {
  const warnings: string[] = [];

  const thesisUnit = assignmentUnits.find((entry) => entry.unitType === PrismaUnitType.THESIS);
  const outlineUnit = assignmentUnits.find((entry) => entry.unitType === PrismaUnitType.OUTLINE);
  const writingUnits = assignmentUnits.filter((entry) => entry.unitType === PrismaUnitType.WRITING);

  const thesisConfirmed = thesisUnit
    ? getContentConfirmed(stateByUnitId.get(thesisUnit.id)?.content ?? null)
    : true;
  const outlineConfirmed = outlineUnit
    ? getContentConfirmed(stateByUnitId.get(outlineUnit.id)?.content ?? null)
    : true;

  if (unit.unitType === PrismaUnitType.OUTLINE && !thesisConfirmed) {
    warnings.push('Outline is not fully ready: thesis is not confirmed yet.');
  }

  if (unit.unitType === PrismaUnitType.WRITING) {
    if (!thesisConfirmed) {
      warnings.push('Writing started before thesis confirmation.');
    }
    if (!outlineConfirmed) {
      warnings.push('Writing started before outline confirmation.');
    }
  }

  if (unit.unitType === PrismaUnitType.REVISE) {
    const incompleteWriting = writingUnits.filter((entry) => {
      const state = stateByUnitId.get(entry.id);
      return state?.status !== UserUnitStatus.COMPLETED;
    });
    if (incompleteWriting.length > 0) {
      warnings.push('Revision started before all writing units were completed.');
    }
  }

  return warnings;
}

function mapUnitState(state: {
  unitId: string;
  status: PrismaUserUnitStatus;
  bookmarked: boolean;
  content: Prisma.JsonValue | null;
  position: Prisma.JsonValue | null;
  updatedAt: Date;
  readinessWarnings?: string[];
}): UserUnitStateDTO {
  return {
    unitId: state.unitId,
    status: fromPrismaUnitStatus(state.status),
    effectiveStatus: toEffectiveStatus(state.status, state.bookmarked),
    bookmarked: state.bookmarked,
    readinessWarnings: state.readinessWarnings ?? [],
    content: jsonToRecord(state.content),
    position: jsonToRecord(state.position),
    updatedAtISO: state.updatedAt.toISOString(),
  };
}

async function createInteractionEvent(
  db: { userInteractionEvent: { create: (args: Prisma.UserInteractionEventCreateArgs) => Promise<unknown> } },
  payload: {
    userId: string;
    assignmentId: string;
    unitId?: string | null;
    eventType:
      | 'unit_opened'
      | 'unit_completed'
      | 'bookmark_toggled'
      | 'chat_used'
      | 'hint_used'
      | 'issue_postponed'
      | 'issue_resolved';
    meta?: Record<string, unknown>;
  },
) {
  await db.userInteractionEvent.create({
    data: {
      userId: payload.userId,
      assignmentId: payload.assignmentId,
      unitId: payload.unitId ?? undefined,
      eventType: toInteractionEventType(payload.eventType),
      meta: payload.meta as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function deleteUserById(id: string): Promise<boolean> {
  const result = await prisma.user.deleteMany({ where: { id } });
  return result.count > 0;
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

export async function createPasswordResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
) {
  return prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    return tx.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  });
}

export async function getPasswordResetTokenByHash(tokenHash: string) {
  return prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

export async function consumePasswordResetTokenAndSetPassword(
  tokenId: string,
  userId: string,
  passwordHash: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: tokenId },
      data: {
        usedAt: new Date(),
      },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
        id: {
          not: tokenId,
        },
      },
      data: {
        usedAt: new Date(),
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
      },
    });

    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
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

  const lookbackDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const events = await prisma.userInteractionEvent.findMany({
    where: {
      userId,
      assignmentId: {
        in: assignmentIds,
      },
      createdAt: {
        gte: lookbackDate,
      },
    },
    select: {
      assignmentId: true,
      eventType: true,
    },
  });

  const eventWeights: Record<PrismaUserInteractionEventType, number> = {
    UNIT_OPENED: 1,
    UNIT_COMPLETED: 3,
    BOOKMARK_TOGGLED: 0.5,
    CHAT_USED: 1,
    HINT_USED: 1,
    ISSUE_POSTPONED: -1,
    ISSUE_RESOLVED: 2,
  };
  const preferenceScores = new Map<string, number>();
  for (const event of events) {
    const current = preferenceScores.get(event.assignmentId) ?? 0;
    preferenceScores.set(event.assignmentId, current + (eventWeights[event.eventType] ?? 0));
  }

  const mapped: AssignmentSummaryDTO[] = assignments.map((assignment) => {
    const currentState = assignment.assignmentState[0] ?? null;
    const completedUnits = completedByAssignment.get(assignment.id) ?? 0;
    const totalUnits = assignment.units.length;
    const isFullyCompleted = totalUnits > 0 && completedUnits >= totalUnits;

    return {
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      taskType: fromPrismaTaskType(assignment.taskType),
      deadlineISO: assignment.deadline.toISOString(),
      status: isFullyCompleted
        ? 'completed'
        : currentState
          ? fromPrismaAssignmentStatus(currentState.status)
          : ('not_started' as const),
      currentUnitId: isFullyCompleted ? null : currentState?.currentUnitId ?? null,
      totalUnits,
      completedUnits,
    };
  });

  return sortAssignmentsByDeadline(mapped, {
    comparableDeadlineWindowMs: 48 * 60 * 60 * 1000,
    preferenceScores,
  });
}

export async function listBookmarkedReadingUnitsForUser(
  userId: string,
): Promise<BookmarkedReadingUnitDTO[]> {
  const states = await prisma.userUnitState.findMany({
    where: {
      userId,
      bookmarked: true,
      unit: {
        unitType: PrismaUnitType.READING,
        assignment: {
          active: true,
        },
      },
    },
    include: {
      unit: {
        select: {
          id: true,
          title: true,
          payload: true,
          assignment: {
            select: {
              id: true,
              title: true,
              subject: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return states.map((state) => {
    const payload = jsonToRecord(state.unit.payload) ?? {};
    const readingText = typeof payload.text === 'string' ? payload.text : '';
    const fallbackText = state.unit.title;

    return {
      unitId: state.unit.id,
      assignmentId: state.unit.assignment.id,
      assignmentTitle: state.unit.assignment.title,
      assignmentSubject: state.unit.assignment.subject,
      unitTitle: state.unit.title,
      preview: buildPreviewFromText(readingText || fallbackText),
      updatedAtISO: state.updatedAt.toISOString(),
    };
  });
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

  const firstUnitId = assignment.units[0]?.id ?? null;
  const validUnitIds = new Set(assignment.units.map((entry) => entry.id));

  let state = await prisma.userAssignmentState.findUnique({
    where: {
      userId_assignmentId: {
        userId,
        assignmentId,
      },
    },
  });

  if (!state) {
    state = await prisma.userAssignmentState.create({
      data: {
        userId,
        assignmentId,
        currentUnitId: firstUnitId,
        status: firstUnitId ? UserAssignmentStatus.IN_PROGRESS : UserAssignmentStatus.NOT_STARTED,
        lastOpenedAt: firstUnitId ? new Date() : null,
      },
    });
  } else {
    const hasMissingCurrentUnit =
      state.currentUnitId !== null && !validUnitIds.has(state.currentUnitId);
    const needsInitialCurrentUnit = state.currentUnitId === null && firstUnitId !== null;

    if (hasMissingCurrentUnit || needsInitialCurrentUnit) {
      state = await prisma.userAssignmentState.update({
        where: {
          userId_assignmentId: {
            userId,
            assignmentId,
          },
        },
        data: {
          currentUnitId: firstUnitId,
          status: firstUnitId ? UserAssignmentStatus.IN_PROGRESS : UserAssignmentStatus.NOT_STARTED,
          completedAt: null,
          lastOpenedAt: firstUnitId ? new Date() : state.lastOpenedAt,
        },
      });
    }
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
          unitType: true,
        },
      },
    },
    orderBy: {
      unit: {
        orderIndex: 'asc',
      },
    },
  });

  const assignmentUnitsForWarnings: UnitRowForWarnings[] = unitStates.map((entry) => ({
    id: entry.unitId,
    unitType: entry.unit.unitType,
    orderIndex: entry.unit.orderIndex,
  }));
  const stateByUnitId = new Map(
    unitStates.map((entry) => [entry.unitId, { status: entry.status, content: entry.content }]),
  );

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
        readinessWarnings: buildReadinessWarningsForUnit(
          {
            id: entry.unitId,
            unitType: entry.unit.unitType,
            orderIndex: entry.unit.orderIndex,
          },
          assignmentUnitsForWarnings,
          stateByUnitId,
        ),
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

  await createInteractionEvent(prisma, {
    userId,
    assignmentId: unit.assignmentId,
    unitId,
    eventType: 'unit_opened',
    meta: {
      patchedKeys: Object.keys(data),
    },
  });

  const lastIssueActionRaw =
    data.content && isRecord(data.content) && isRecord(data.content.lastIssueAction)
      ? data.content.lastIssueAction
      : null;
  const lastIssueActionStatus =
    typeof lastIssueActionRaw?.status === 'string' ? lastIssueActionRaw.status : null;
  if (lastIssueActionStatus === 'postponed' || lastIssueActionStatus === 'resolved') {
    await createInteractionEvent(prisma, {
      userId,
      assignmentId: unit.assignmentId,
      unitId,
      eventType: lastIssueActionStatus === 'postponed' ? 'issue_postponed' : 'issue_resolved',
      meta: {
        issueKey:
          typeof lastIssueActionRaw?.issueKey === 'string' ? lastIssueActionRaw.issueKey : undefined,
      },
    });
    await recalculateScheduleForAssignment(userId, unit.assignmentId).catch(() => undefined);
  }

  return mapUnitState({
    unitId: saved.unitId,
    status: saved.status,
    bookmarked: saved.bookmarked,
    content: saved.content,
    position: saved.position,
    updatedAt: saved.updatedAt,
    readinessWarnings: [],
  });
}

export async function completeUnitForUser(
  userId: string,
  unitId: string,
): Promise<CompleteUnitResponse> {
  let assignmentIdForSchedule: string | null = null;

  const result = await prisma.$transaction(async (tx) => {
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
    assignmentIdForSchedule = unit.assignmentId;

    let assignmentState = await tx.userAssignmentState.findUnique({
      where: {
        userId_assignmentId: {
          userId,
          assignmentId: unit.assignmentId,
        },
      },
    });

    if (!assignmentState) {
      const createdState = await tx.userAssignmentState.create({
        data: {
          userId,
          assignmentId: unit.assignmentId,
          currentUnitId: unit.assignment.units[0]?.id ?? null,
          status: UserAssignmentStatus.IN_PROGRESS,
          lastOpenedAt: new Date(),
        },
      });
      assignmentState = createdState;

      const currentUnitId = createdState.currentUnitId;
      await tx.userUnitState.createMany({
        data: unit.assignment.units.map((entry) => ({
          userId,
          unitId: entry.id,
          status: entry.id === currentUnitId ? UserUnitStatus.ACTIVE : UserUnitStatus.UNREAD,
        })),
        skipDuplicates: true,
      });
    }

    if (!assignmentState) {
      throw new UnauthorizedTransitionError('Assignment state is not initialized.');
    }

    const allowsOutOfOrderCompletion = fromPrismaTaskType(unit.assignment.taskType) === 'essay';

    if (!allowsOutOfOrderCompletion && assignmentState.currentUnitId !== unitId) {
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
        content: true,
      },
    });

    const unitStatesById = new Map(
      unitStates.map((entry) => [entry.unitId, { status: entry.status, content: entry.content }]),
    );
    const readinessWarnings = buildReadinessWarningsForUnit(
      {
        id: unit.id,
        unitType: unit.unitType,
        orderIndex: unit.orderIndex,
      },
      unit.assignment.units.map((entry) => ({
        id: entry.id,
        unitType: entry.unitType,
        orderIndex: entry.orderIndex,
      })),
      unitStatesById,
    );

    const completedSet = new Set(
      unitStates
        .filter((entry) => entry.status === UserUnitStatus.COMPLETED)
        .map((entry) => entry.unitId),
    );

    const nextUnit = allowsOutOfOrderCompletion
      ? unit.assignment.units.find((candidate) => !completedSet.has(candidate.id))
      : unit.assignment.units.find(
          (candidate) => candidate.orderIndex > unit.orderIndex && !completedSet.has(candidate.id),
        );

    let nextAssignmentStatus: PrismaUserAssignmentStatus = UserAssignmentStatus.COMPLETED;
    if (nextUnit) {
      nextAssignmentStatus = UserAssignmentStatus.IN_PROGRESS;
      await tx.userUnitState.updateMany({
        where: {
          userId,
          status: UserUnitStatus.ACTIVE,
          unitId: {
            not: nextUnit.id,
          },
          unit: {
            assignmentId: unit.assignmentId,
          },
        },
        data: {
          status: UserUnitStatus.UNREAD,
        },
      });

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

    await createInteractionEvent(tx, {
      userId,
      assignmentId: unit.assignmentId,
      unitId,
      eventType: 'unit_completed',
      meta: {
        warnings: readinessWarnings,
      },
    });

    const assignmentStatus: CompleteUnitResponse['assignmentStatus'] =
      nextAssignmentStatus === UserAssignmentStatus.COMPLETED ? 'completed' : 'in_progress';
    const gateStatus: CompleteUnitResponse['gateStatus'] =
      readinessWarnings.length > 0 ? 'warn' : 'ready';

    return {
      completedUnitId: unitId,
      nextUnitId: nextUnit?.id ?? null,
      assignmentStatus,
      gateStatus,
      warnings: readinessWarnings,
    };
  });

  if (assignmentIdForSchedule) {
    await recalculateScheduleForAssignment(userId, assignmentIdForSchedule).catch(() => undefined);
  }

  return result;
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

  await createInteractionEvent(prisma, {
    userId,
    assignmentId: unit.assignmentId,
    unitId,
    eventType: 'bookmark_toggled',
    meta: {
      bookmarked: payload.bookmarked,
    },
  });

  return mapUnitState({
    unitId: saved.unitId,
    status: saved.status,
    bookmarked: saved.bookmarked,
    content: saved.content,
    position: saved.position,
    updatedAt: saved.updatedAt,
    readinessWarnings: [],
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
      unitId: unit.id,
      title: unit.title,
      text,
      targetWords: unit.targetWords ?? 0,
    };
  });
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function mapUnitTypeToScheduleGoalType(unitType: PrismaUnitTypeValue): ScheduleGoal['goalType'] {
  switch (unitType) {
    case PrismaUnitType.THESIS:
      return 'thesis';
    case PrismaUnitType.OUTLINE:
      return 'outline';
    case PrismaUnitType.WRITING:
      return 'writing';
    case PrismaUnitType.REVISE:
      return 'revise';
    case PrismaUnitType.READING:
      return 'sources';
  }

  return 'sources';
}

function mapScheduleItem(item: {
  id: string;
  assignmentId: string;
  dateISO: Date;
  goalType: PrismaScheduleGoalType;
  unitId: string | null;
  targetWords: number | null;
  status: PrismaScheduleItemStatus;
  title: string;
}): ScheduleGoal {
  return {
    id: item.id,
    assignmentId: item.assignmentId,
    dateISO: item.dateISO.toISOString(),
    goalType: fromScheduleGoalType(item.goalType),
    unitId: item.unitId,
    targetWords: item.targetWords,
    status: fromScheduleItemStatus(item.status),
    title: item.title,
  };
}

export async function getAssignmentUnitById(unitId: string) {
  const unit = await prisma.assignmentUnit.findUnique({
    where: { id: unitId },
    include: {
      assignment: {
        select: {
          id: true,
          title: true,
          subject: true,
          deadline: true,
          taskType: true,
          active: true,
        },
      },
    },
  });

  if (!unit || !unit.assignment.active) {
    throw new NotFoundError('Unit not found.');
  }

  return {
    id: unit.id,
    assignmentId: unit.assignmentId,
    unitType: fromPrismaUnitType(unit.unitType),
    orderIndex: unit.orderIndex,
    title: unit.title,
    payload: (jsonToRecord(unit.payload) ?? {}) as Record<string, unknown>,
    targetWords: unit.targetWords,
    assignment: {
      id: unit.assignment.id,
      title: unit.assignment.title,
      subject: unit.assignment.subject,
      deadlineISO: unit.assignment.deadline.toISOString(),
      taskType: fromPrismaTaskType(unit.assignment.taskType),
    },
  };
}

export async function getUnitStateByIdForUser(userId: string, unitId: string): Promise<UserUnitStateDTO | null> {
  const unit = await prisma.assignmentUnit.findUnique({
    where: { id: unitId },
    select: {
      assignmentId: true,
    },
  });
  if (!unit) {
    return null;
  }

  await ensureAssignmentState(userId, unit.assignmentId);
  const state = await prisma.userUnitState.findUnique({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
  });
  if (!state) {
    return null;
  }

  return mapUnitState({
    unitId: state.unitId,
    status: state.status,
    bookmarked: state.bookmarked,
    content: state.content,
    position: state.position,
    updatedAt: state.updatedAt,
    readinessWarnings: [],
  });
}

export async function saveThesisSuggestionsForUnit(
  userId: string,
  unitId: string,
  suggestions: ThesisSuggestion[],
): Promise<UserUnitStateDTO> {
  return patchUnitStateForUser(userId, unitId, {
    content: {
      thesisSuggestions: suggestions,
    },
  });
}

export async function createClarificationTurnForUnit(
  userId: string,
  unitId: string,
  userMessage: string,
  assistantMessage: string,
): Promise<ClarificationTurn> {
  const unit = await prisma.assignmentUnit.findUnique({
    where: { id: unitId },
    include: {
      assignment: {
        select: {
          id: true,
          active: true,
        },
      },
    },
  });

  if (!unit || !unit.assignment.active) {
    throw new NotFoundError('Unit not found.');
  }

  const session = await prisma.unitChatSession.upsert({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
    create: {
      userId,
      unitId,
    },
    update: {},
  });

  const turn = await prisma.unitChatTurn.create({
    data: {
      sessionId: session.id,
      userMessage,
      assistantMessage,
    },
  });

  await createInteractionEvent(prisma, {
    userId,
    assignmentId: unit.assignmentId,
    unitId,
    eventType: 'chat_used',
  });
  await recalculateScheduleForAssignment(userId, unit.assignmentId).catch(() => undefined);

  return {
    id: turn.id,
    unitId,
    userMessage: turn.userMessage,
    assistantMessage: turn.assistantMessage,
    createdAtISO: turn.createdAt.toISOString(),
  };
}

export async function listClarificationTurnsForUnit(
  userId: string,
  unitId: string,
  limit = 20,
): Promise<ClarificationTurn[]> {
  const session = await prisma.unitChatSession.findUnique({
    where: {
      userId_unitId: {
        userId,
        unitId,
      },
    },
    include: {
      turns: {
        orderBy: {
          createdAt: 'asc',
        },
        take: Math.max(1, Math.min(limit, 100)),
      },
    },
  });

  if (!session) {
    return [];
  }

  return session.turns.map((turn) => ({
    id: turn.id,
    unitId,
    userMessage: turn.userMessage,
    assistantMessage: turn.assistantMessage,
    createdAtISO: turn.createdAt.toISOString(),
  }));
}

export async function recordInteractionEvent(payload: {
  userId: string;
  assignmentId: string;
  unitId?: string | null;
  eventType:
    | 'unit_opened'
    | 'unit_completed'
    | 'bookmark_toggled'
    | 'chat_used'
    | 'hint_used'
    | 'issue_postponed'
    | 'issue_resolved';
  meta?: Record<string, unknown>;
}) {
  await createInteractionEvent(prisma, payload);
}

export async function recalculateScheduleForAssignment(
  userId: string,
  assignmentId: string,
): Promise<ScheduleGoal[]> {
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

  await ensureAssignmentState(userId, assignmentId);
  const states = await prisma.userUnitState.findMany({
    where: {
      userId,
      unit: {
        assignmentId,
      },
    },
    select: {
      unitId: true,
      status: true,
    },
  });
  const completed = new Set(
    states.filter((entry) => entry.status === UserUnitStatus.COMPLETED).map((entry) => entry.unitId),
  );

  const remainingUnits = assignment.units.filter((unit) => !completed.has(unit.id));

  await prisma.userScheduleItem.deleteMany({
    where: {
      userId,
      assignmentId,
    },
  });

  if (remainingUnits.length === 0) {
    return [];
  }

  const now = new Date();
  const startDate = startOfUtcDay(now);
  const endDate = startOfUtcDay(assignment.deadline);
  const daysRemaining = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );

  const itemsData = remainingUnits.map((unit, index) => {
    const dayOffset = Math.min(daysRemaining - 1, Math.floor((index * daysRemaining) / remainingUnits.length));
    const dateISO = addUtcDays(startDate, dayOffset);
    return {
      userId,
      assignmentId,
      dateISO,
      goalType: toScheduleGoalType(mapUnitTypeToScheduleGoalType(unit.unitType)),
      unitId: unit.id,
      targetWords: unit.targetWords,
      status: ScheduleItemStatus.PENDING,
      title: unit.title,
    };
  });

  await prisma.userScheduleItem.createMany({
    data: itemsData,
  });

  const saved = await prisma.userScheduleItem.findMany({
    where: {
      userId,
      assignmentId,
    },
    orderBy: [{ dateISO: 'asc' }, { createdAt: 'asc' }],
  });

  return saved.map((item) =>
    mapScheduleItem({
      id: item.id,
      assignmentId: item.assignmentId,
      dateISO: item.dateISO,
      goalType: item.goalType,
      unitId: item.unitId,
      targetWords: item.targetWords,
      status: item.status,
      title: item.title,
    }),
  );
}

export async function getScheduleForAssignment(userId: string, assignmentId: string): Promise<ScheduleGoal[]> {
  return recalculateScheduleForAssignment(userId, assignmentId);
}
