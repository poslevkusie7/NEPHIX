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
import { sanitizeClarificationResponse } from '@/lib/ai/validators';
import { getXaiModelChat } from '@/lib/env';

function shouldRejectScope(message: string): boolean {
  const lower = message.toLowerCase();
  const blocked = [
    'rewrite',
    'summarize everything',
    'write me an essay',
    'replace the text',
    'new version',
    'unrelated',
  ];
  return blocked.some((entry) => lower.includes(entry));
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
    if (shouldRejectScope(payload.message)) {
      return NextResponse.json(
        { error: 'Clarification chat only supports local explanations of this unit text.' },
        { status: 400 },
      );
    }

    const unit = await getAssignmentUnitById(params.unitId);
    if (unit.unitType !== 'reading') {
      throw new ValidationError('Clarification chat is available only for reading units.');
    }

    const sourceText = typeof unit.payload.text === 'string' ? unit.payload.text : '';
    const previousTurns = await listClarificationTurnsForUnit(user.id, params.unitId, 6);
    const conversation = previousTurns.flatMap((turn) => [
      { role: 'user' as const, content: turn.userMessage },
      { role: 'assistant' as const, content: turn.assistantMessage },
    ]);

    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'You are a reading clarification tutor. Answer the user question directly in at most 3 sentences. Use only the provided unit text. If asked about a word or phrase, define it plainly and tie it to this fragment. Do not ask the user to re-ask. Do not rewrite or summarize the full unit.',
        },
        {
          role: 'system',
          content: `UNIT TEXT:\n${sourceText}`,
        },
        ...conversation,
        {
          role: 'user',
          content: payload.message,
        },
      ],
      {
        model: getXaiModelChat(),
        temperature: 0.1,
        maxTokens: 220,
      },
    );

    const assistantMessage = sanitizeClarificationResponse(
      aiRaw ?? '',
      sourceText,
      payload.message,
    );

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
