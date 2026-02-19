import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ValidationError,
  getAssignmentUnitById,
  getUnitStateByIdForUser,
  patchUnitStateForUser,
} from '@nephix/db';
import { thesisSuggestionsRequestSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';
import { tryCompleteWithXai } from '@/lib/ai/client';
import { getXaiModelThesis } from '@/lib/env';
import { normalizeThesisSuggestions } from '@/lib/ai/validators';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const payload = await parseJsonBody(request, thesisSuggestionsRequestSchema);
    const unit = await getAssignmentUnitById(params.unitId);
    if (unit.unitType !== 'thesis') {
      throw new ValidationError('Thesis suggestions can only be generated for thesis units.');
    }

    const state = await getUnitStateByIdForUser(user.id, params.unitId);
    const existingContent = isRecord(state?.content) ? state.content : {};
    const existingSuggestions = Array.isArray(existingContent.thesisSuggestions)
      ? existingContent.thesisSuggestions
      : [];

    if (!payload.regenerate && existingSuggestions.length >= 3) {
      return NextResponse.json({ suggestions: existingSuggestions, replaced: false });
    }

    const topic = typeof unit.payload.topic === 'string' ? unit.payload.topic : unit.assignment.title;
    const essayType =
      unit.payload.essayType === 'opinion' ||
      unit.payload.essayType === 'analytical' ||
      unit.payload.essayType === 'comparative' ||
      unit.payload.essayType === 'interpretive'
        ? unit.payload.essayType
        : 'opinion';
    const wordCount = typeof unit.payload.wordCount === 'number' ? unit.payload.wordCount : 1000;

    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'Generate 3-5 distinct thesis statements. Each must be debatable, relevant, and scalable for the requested essay length. Output each thesis on a new line without extra commentary.',
        },
        {
          role: 'user',
          content: `Topic: ${topic}\nEssay type: ${essayType}\nWord count: ${wordCount}`,
        },
      ],
      {
        model: getXaiModelThesis(),
        temperature: 0.5,
        maxTokens: 280,
      },
    );

    const suggestions = normalizeThesisSuggestions(aiRaw ?? '', topic);
    const saved = await patchUnitStateForUser(user.id, params.unitId, {
      content: {
        thesisSuggestions: suggestions,
      },
    });

    const savedContent = isRecord(saved.content) ? saved.content : {};
    const finalSuggestions = Array.isArray(savedContent.thesisSuggestions)
      ? savedContent.thesisSuggestions
      : suggestions;

    return NextResponse.json({ suggestions: finalSuggestions, replaced: Boolean(payload.regenerate) });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError || error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to generate thesis suggestions.' }, { status: 500 });
  }
}
