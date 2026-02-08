-- CreateEnum
CREATE TYPE "AssignmentTaskType" AS ENUM ('READING', 'ESSAY');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('READING', 'THESIS', 'OUTLINE', 'WRITING', 'REVISE');

-- CreateEnum
CREATE TYPE "UserAssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UserUnitStatus" AS ENUM ('UNREAD', 'ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "taskType" "AssignmentTaskType" NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "seedKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentUnit" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "unitType" "UnitType" NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "targetWords" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAssignmentState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "currentUnitId" TEXT,
    "status" "UserAssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "lastOpenedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAssignmentState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserUnitState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "status" "UserUnitStatus" NOT NULL DEFAULT 'UNREAD',
    "bookmarked" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB,
    "position" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserUnitState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_seedKey_key" ON "Assignment"("seedKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentUnit_assignmentId_orderIndex_key" ON "AssignmentUnit"("assignmentId", "orderIndex");

-- CreateIndex
CREATE INDEX "AssignmentUnit_assignmentId_idx" ON "AssignmentUnit"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAssignmentState_userId_assignmentId_key" ON "UserAssignmentState"("userId", "assignmentId");

-- CreateIndex
CREATE INDEX "UserAssignmentState_assignmentId_idx" ON "UserAssignmentState"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserUnitState_userId_unitId_key" ON "UserUnitState"("userId", "unitId");

-- CreateIndex
CREATE INDEX "UserUnitState_unitId_idx" ON "UserUnitState"("unitId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentUnit" ADD CONSTRAINT "AssignmentUnit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignmentState" ADD CONSTRAINT "UserAssignmentState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignmentState" ADD CONSTRAINT "UserAssignmentState_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserUnitState" ADD CONSTRAINT "UserUnitState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserUnitState" ADD CONSTRAINT "UserUnitState_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "AssignmentUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
