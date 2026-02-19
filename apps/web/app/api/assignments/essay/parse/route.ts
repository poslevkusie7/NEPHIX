import { NextResponse } from 'next/server';
import { essayParseRequestSchema, essayParseResultSchema } from '@nephix/contracts';
import { requireAuthenticatedUser } from '@/lib/auth/require-user';
import { parseJsonBody } from '@/lib/http';
import { tryCompleteWithXai } from '@/lib/ai/client';
import { parseJsonObject } from '@/lib/ai/validators';
import { getXaiModelParse } from '@/lib/env';

function detectEssayType(prompt: string): 'opinion' | 'analytical' | 'comparative' | 'interpretive' {
  const lower = prompt.toLowerCase();
  if (lower.includes('comparative') || lower.includes('compare')) {
    return 'comparative';
  }
  if (lower.includes('interpretive') || lower.includes('interpretation')) {
    return 'interpretive';
  }
  if (lower.includes('analytical') || lower.includes('analy')) {
    return 'analytical';
  }
  return 'opinion';
}

function detectWordCount(prompt: string): number {
  const match = prompt.match(/\b(\d{3,5})\s*(?:-|\s)?word/i);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 1000;
}

function detectTopic(prompt: string): string {
  const topicMatch = prompt.match(/\b(?:on|about)\s+(.+?)(?:,|\.|due\b|$)/i);
  if (topicMatch?.[1]) {
    return topicMatch[1].trim();
  }

  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  return cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
}

function nextWeekdayIso(dayIndex: number): string {
  const now = new Date();
  const result = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 0, 0));
  const current = result.getUTCDay();
  let delta = (dayIndex - current + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  result.setUTCDate(result.getUTCDate() + delta);
  return result.toISOString();
}

function detectDeadlineISO(prompt: string): string | null {
  const dateMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch?.[1]) {
    return new Date(`${dateMatch[1]}T23:59:00.000Z`).toISOString();
  }

  const lower = prompt.toLowerCase();
  if (lower.includes('tomorrow')) {
    const now = new Date();
    const result = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 0, 0));
    return result.toISOString();
  }
  if (lower.includes('today')) {
    const now = new Date();
    const result = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 0, 0));
    return result.toISOString();
  }

  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  for (const [name, index] of Object.entries(weekdays)) {
    if (lower.includes(`next ${name}`)) {
      return nextWeekdayIso(index);
    }
  }

  return null;
}

function fallbackParse(prompt: string) {
  return {
    topic: detectTopic(prompt),
    essayType: detectEssayType(prompt),
    wordCount: detectWordCount(prompt),
    deadlineISO: detectDeadlineISO(prompt),
    confidence: 0.55,
  };
}

export async function POST(request: Request) {
  const user = await requireAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = await parseJsonBody(request, essayParseRequestSchema);

    const aiRaw = await tryCompleteWithXai(
      [
        {
          role: 'system',
          content:
            'Extract essay assignment parameters as compact JSON with keys: topic, essayType(opinion|analytical|comparative|interpretive), wordCount(number), deadlineISO(ISO8601 or null), confidence(0..1).',
        },
        {
          role: 'user',
          content: payload.prompt,
        },
      ],
      {
        model: getXaiModelParse(),
        temperature: 0.1,
        maxTokens: 240,
      },
    );

    const parsedFromAi = aiRaw ? parseJsonObject<unknown>(aiRaw) : null;
    const candidate = parsedFromAi && typeof parsedFromAi === 'object' ? parsedFromAi : fallbackParse(payload.prompt);
    const result = essayParseResultSchema.parse(candidate);

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to parse essay prompt.' }, { status: 500 });
  }
}
