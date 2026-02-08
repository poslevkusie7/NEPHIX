import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import prisma from './client';
import { toPrismaTaskType, toPrismaUnitType } from './mappers';

const seedUnitSchema = z.object({
  orderIndex: z.number().int().nonnegative(),
  unitType: z.enum(['reading', 'thesis', 'outline', 'writing', 'revise']),
  title: z.string().min(1),
  payload: z.record(z.any()),
  targetWords: z.number().int().positive().nullable().optional(),
});

const seedAssignmentSchema = z.object({
  seedKey: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  taskType: z.enum(['reading', 'essay']),
  deadlineISO: z.string().datetime(),
  active: z.boolean().default(true),
  units: z.array(seedUnitSchema).min(1),
});

async function loadSeedAssignments() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const seedDirectory = path.resolve(__dirname, '../prisma/seed-data');
  const files = (await readdir(seedDirectory)).filter((name) => name.endsWith('.json'));

  const assignments = [];
  for (const file of files) {
    const raw = await readFile(path.join(seedDirectory, file), 'utf-8');
    const parsed = JSON.parse(raw);
    assignments.push(seedAssignmentSchema.parse(parsed));
  }

  return assignments;
}

async function seed() {
  const assignments = await loadSeedAssignments();

  for (const assignment of assignments) {
    const upserted = await prisma.assignment.upsert({
      where: {
        seedKey: assignment.seedKey,
      },
      create: {
        title: assignment.title,
        subject: assignment.subject,
        taskType: toPrismaTaskType(assignment.taskType),
        deadline: new Date(assignment.deadlineISO),
        active: assignment.active,
        seedKey: assignment.seedKey,
      },
      update: {
        title: assignment.title,
        subject: assignment.subject,
        taskType: toPrismaTaskType(assignment.taskType),
        deadline: new Date(assignment.deadlineISO),
        active: assignment.active,
      },
    });

    await prisma.assignmentUnit.deleteMany({
      where: {
        assignmentId: upserted.id,
      },
    });

    await prisma.assignmentUnit.createMany({
      data: assignment.units.map((unit) => ({
        assignmentId: upserted.id,
        orderIndex: unit.orderIndex,
        unitType: toPrismaUnitType(unit.unitType),
        title: unit.title,
        payload: unit.payload,
        targetWords: unit.targetWords ?? null,
      })),
    });

    console.log(`Seeded assignment: ${assignment.seedKey}`);
  }
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
