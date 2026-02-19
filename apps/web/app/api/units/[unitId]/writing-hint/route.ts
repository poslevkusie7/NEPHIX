import { NextResponse } from 'next/server';
import {
  NotFoundError,
  ValidationError,
  collectWritingSectionsForAssignment,
  getAssignmentStateForUser,
  getAssignmentUnitById,
  patchUnitStateForUser,
  recordInteractionEvent,
  recalculateScheduleForAssignment,
} from '@nephix/db';
import { writingHintRequestSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';
import { tryCompleteWithXai } from '@/lib/ai/client';
import { enforceSingleSentenceHint } from '@/lib/ai/validators';
import { getXaiModelHint } from '@/lib/env';

function summarizePreviousSections(sections: Array<{ title: string; text: string }>, activeTitle: string): string {
  const previous = sections.filter((section) => section.title !== activeTitle).slice(0, 3);
  if (previous.length === 0) {
    return 'No previous sections yet.';
  }

  return previous
    .map((section) => {
      const trimmed = section.text.trim().replace(/\s+/g, ' ');
      const summary = trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
      return `${section.title}: ${summary || '[empty]'}`;
    })
    .join('\n');
}

export async function POST(request: Request, context: { params: Promise<{ unitId: string }> }) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = await context.params;
    const payload = await parseJsonBody(request, writingHintRequestSchema);
    const unit = await getAssignmentUnitById(params.unitId);
    if (unit.unitType !== 'writing') {
      throw new ValidationError('Writing hint is only available for writing units.');
    }

    const assignmentState = await getAssignmentStateForUser(user.id, unit.assignmentId);
    const thesisUnitState = assignmentState.unitStates.find((entry) => {
      if (!entry.content || typeof entry.content !== 'object') {
        return false;
      }
      const content = entry.content as Record<string, unknown>;
      return typeof content.thesis === 'string';
    });
    const thesisContent =
      thesisUnitState?.content && typeof thesisUnitState.content === 'object'
        ? (thesisUnitState.content as Record<string, unknown>)
        : {};
    const thesis =
      typeof thesisContent.thesis === 'string'
        ? thesisContent.thesis
        : 'Use the assignment thesis to keep the section focused and argumentative.';

    const sections = await collectWritingSectionsForAssignment(user.id, unit.assignmentId);
    const currentSection = sections.find((section) => section.unitId === unit.id);
    const sectionTitle =
      typeof unit.payload.sectionTitle === 'string'
        ? unit.payload.sectionTitle
        : currentSection?.title ?? unit.title;
    const currentText = payload.currentSectionText ?? currentSection?.text ?? '';
    const previousSummary = summarizePreviousSections(sections, currentSection?.title ?? unit.title);

    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content: `You are an AI writing assistant whose sole purpose is to help the user decide what to write next.
Rules:
- Never write essay content.
- Never generate sentences that could be copied into the essay.
- Never give examples, templates, or sample phrases.
- Never mention writing frameworks, mnemonics, or theory.
- Do not explain concepts or teach rules.
- Output must be exactly one sentence.`,
        },
        {
          role: 'user',
          content: `Essay thesis:
${thesis}

Active section:
${sectionTitle}

Text already written in this section:
${currentText || '[empty]'}

Relevant text from previous sections:
${previousSummary}

Task:
Generate one short hint that helps the user decide what to do next in the active section.`,
        },
      ],
      {
        model: getXaiModelHint(),
        temperature: 0.2,
        maxTokens: 90,
      },
    );

    const hintText = enforceSingleSentenceHint(
      aiRaw ??
        'Clarify one claim in this section and connect it directly to your thesis before adding more detail.',
    );

    await patchUnitStateForUser(user.id, params.unitId, {
      content: {
        writingHint: hintText,
      },
    });
    await recordInteractionEvent({
      userId: user.id,
      assignmentId: unit.assignmentId,
      unitId: unit.id,
      eventType: 'hint_used',
    });
    await recalculateScheduleForAssignment(user.id, unit.assignmentId).catch(() => undefined);

    return NextResponse.json({ hint: { text: hintText } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError || error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to generate writing hint.' }, { status: 500 });
  }
}
