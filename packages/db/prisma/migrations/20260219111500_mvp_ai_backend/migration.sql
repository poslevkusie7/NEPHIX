-- CreateEnum
CREATE TYPE "UserInteractionEventType" AS ENUM (
    'UNIT_OPENED',
    'UNIT_COMPLETED',
    'BOOKMARK_TOGGLED',
    'CHAT_USED',
    'HINT_USED',
    'ISSUE_POSTPONED',
    'ISSUE_RESOLVED'
);

-- CreateEnum
CREATE TYPE "ScheduleGoalType" AS ENUM ('SOURCES', 'THESIS', 'OUTLINE', 'WRITING', 'REVISE');

-- CreateEnum
CREATE TYPE "ScheduleItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "UserInteractionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "unitId" TEXT,
    "eventType" "UserInteractionEventType" NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitChatTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "assistantMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitChatTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScheduleItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "dateISO" TIMESTAMP(3) NOT NULL,
    "goalType" "ScheduleGoalType" NOT NULL,
    "unitId" TEXT,
    "targetWords" INTEGER,
    "status" "ScheduleItemStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserInteractionEvent_userId_createdAt_idx" ON "UserInteractionEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserInteractionEvent_assignmentId_createdAt_idx" ON "UserInteractionEvent"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "UserInteractionEvent_unitId_idx" ON "UserInteractionEvent"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitChatSession_userId_unitId_key" ON "UnitChatSession"("userId", "unitId");

-- CreateIndex
CREATE INDEX "UnitChatSession_unitId_updatedAt_idx" ON "UnitChatSession"("unitId", "updatedAt");

-- CreateIndex
CREATE INDEX "UnitChatTurn_sessionId_createdAt_idx" ON "UnitChatTurn"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "UserScheduleItem_userId_dateISO_idx" ON "UserScheduleItem"("userId", "dateISO");

-- CreateIndex
CREATE INDEX "UserScheduleItem_assignmentId_dateISO_idx" ON "UserScheduleItem"("assignmentId", "dateISO");

-- CreateIndex
CREATE INDEX "UserScheduleItem_unitId_idx" ON "UserScheduleItem"("unitId");

-- AddForeignKey
ALTER TABLE "UserInteractionEvent"
ADD CONSTRAINT "UserInteractionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInteractionEvent"
ADD CONSTRAINT "UserInteractionEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInteractionEvent"
ADD CONSTRAINT "UserInteractionEvent_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AssignmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitChatSession"
ADD CONSTRAINT "UnitChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitChatSession"
ADD CONSTRAINT "UnitChatSession_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AssignmentUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitChatTurn"
ADD CONSTRAINT "UnitChatTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UnitChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScheduleItem"
ADD CONSTRAINT "UserScheduleItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScheduleItem"
ADD CONSTRAINT "UserScheduleItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScheduleItem"
ADD CONSTRAINT "UserScheduleItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AssignmentUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
