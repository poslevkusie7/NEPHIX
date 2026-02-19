import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ValidationError,
  createClarificationTurnForUnit,
  getAssignmentUnitById,
  listClarificationTurnsForUnit,
} from '@nephix/db';
import { unitChatRequestSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';
import { tryCompleteWithXai } from '@/lib/ai/client';
import { getXaiModelChat } from '@/lib/env';

function capWords(text: string, maxWords: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return '';
  }

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= maxWords) {
    return cleaned;
  }

  return words.slice(0, maxWords).join(' ');
}

export async function GET(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const turns = await listClarificationTurnsForUnit(user.id, params.unitId);
    return NextResponse.json({ turns });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to load chat history.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const payload = await parseJsonBody(request, unitChatRequestSchema);

    const unit = await getAssignmentUnitById(params.unitId);
    if (unit.unitType !== 'reading') {
      throw new ValidationError('Clarification chat is available only for reading units.');
    }

    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'Answer the user question directly. Maximum 10 words. No preface.',
        },
        {
          role: 'user',
          content: payload.message,
        },
      ],
      {
        model: getXaiModelChat(),
        temperature: 0,
        maxTokens: 60,
      },
    );

    if (!aiRaw) {
      return NextResponse.json(
        { error: 'AI response unavailable. Check XAI_API_KEY and model configuration.' },
        { status: 502 },
      );
    }

    const assistantMessage = capWords(aiRaw, 10);
    if (!assistantMessage) {
      return NextResponse.json({ error: 'AI returned an empty response.' }, { status: 502 });
    }

    const turn = await createClarificationTurnForUnit(
      user.id,
      params.unitId,
      payload.message,
      assistantMessage,
    );

    return NextResponse.json({ turn });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError || error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to process clarification chat.' }, { status: 500 });
  }
}
