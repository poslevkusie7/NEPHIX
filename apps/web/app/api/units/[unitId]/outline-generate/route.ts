import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  NotFoundError,
  ValidationError,
  getAssignmentDetailById,
  getAssignmentStateForUser,
  getAssignmentUnitById,
  patchUnitStateForUser,
} from '@nephix/db';
import { outlineSectionSchema } from '@nephix/contracts';
import { buildInitialOutline } from '@nephix/domain';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { tryCompleteWithXai } from '@/lib/ai/client';
import { getXaiModelThesis } from '@/lib/env';
import { parseJsonObject } from '@/lib/ai/validators';

const outlineSectionsSchema = z.array(outlineSectionSchema).min(5).max(7);

function normalizeSectionWordTotals(
  sections: Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>,
  targetWordCount: number,
) {
  const safeTarget = Math.max(250, targetWordCount);
  const total = sections.reduce((sum, section) => sum + Math.max(0, section.targetWords), 0);
  if (total <= 0) {
    return buildInitialOutline(safeTarget);
  }

  const normalized = sections.map((section) => ({
    ...section,
    targetWords: Math.max(30, Math.round((section.targetWords / total) * safeTarget)),
  }));
  const normalizedTotal = normalized.reduce((sum, section) => sum + section.targetWords, 0);
  const delta = safeTarget - normalizedTotal;
  normalized[normalized.length - 1].targetWords += delta;
  return normalized;
}

export async function POST(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const unit = await getAssignmentUnitById(params.unitId);
    if (unit.unitType !== 'outline') {
      throw new ValidationError('Outline generation is only available for outline units.');
    }

    const [assignment, state] = await Promise.all([
      getAssignmentDetailById(unit.assignmentId),
      getAssignmentStateForUser(user.id, unit.assignmentId),
    ]);
    const thesisUnit = assignment.units.find((entry) => entry.unitType === 'thesis');
    if (!thesisUnit) {
      throw new ValidationError('Cannot generate outline without thesis context.');
    }
    const thesisState = state.unitStates.find((entry) => entry.unitId === thesisUnit.id);
    const thesisContent =
      thesisState && typeof thesisState.content === 'object' && thesisState.content !== null
        ? thesisState.content
        : {};
    const thesis =
      typeof thesisContent.thesis === 'string' && thesisContent.thesis.trim().length > 0
        ? thesisContent.thesis.trim()
        : null;
    const thesisConfirmed = Boolean(
      thesisContent && typeof thesisContent === 'object' && thesisContent !== null
        ? (thesisContent as Record<string, unknown>).confirmed
        : false,
    );

    if (!thesis || !thesisConfirmed) {
      throw new ValidationError('Outline generation requires a confirmed thesis first.');
    }

    const wordCount = typeof thesisUnit.payload.wordCount === 'number' ? thesisUnit.payload.wordCount : 1000;
    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'Generate a 5-7 section essay outline as JSON array. Each item must include id,title,guidingQuestion,targetWords (integer).',
        },
        {
          role: 'user',
          content: `Thesis: ${thesis}\nTarget words: ${wordCount}\nReturn only JSON.`,
        },
      ],
      {
        model: getXaiModelThesis(),
        temperature: 0.4,
        maxTokens: 420,
      },
    );

    const parsed = aiRaw ? parseJsonObject<unknown>(aiRaw) : null;
    const candidate = parsed ? outlineSectionsSchema.safeParse(parsed) : { success: false as const };
    const sections = normalizeSectionWordTotals(
      candidate.success ? candidate.data : buildInitialOutline(wordCount),
      wordCount,
    );

    await patchUnitStateForUser(user.id, params.unitId, {
      content: {
        sections,
      },
    });

    return NextResponse.json({ sections });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError || error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to generate outline.' }, { status: 500 });
  }
}
