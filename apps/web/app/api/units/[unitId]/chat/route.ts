import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ValidationError,
  createClarificationTurnForUnit,
  getAssignmentUnitById,
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
    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'You are a clarification assistant. Explain only this unit text. Keep response short (max 3 sentences), anchored to specific ideas in the text, and never rewrite/summarize the whole unit.',
        },
        {
          role: 'user',
          content: `UNIT TEXT:\n${sourceText}\n\nQUESTION:\n${payload.message}`,
        },
      ],
      {
        model: getXaiModelChat(),
        temperature: 0.2,
        maxTokens: 220,
      },
    );

    const assistantMessage = sanitizeClarificationResponse(
      aiRaw ??
        'I can clarify a specific phrase from this fragment if you point to the exact part that is unclear.',
      sourceText,
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
