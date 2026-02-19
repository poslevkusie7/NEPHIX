import type { ThesisSuggestion } from '@nephix/contracts';

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenizeMeaningful(text: string): string[] {
  const stopwords = new Set([
    'a',
    'an',
    'and',
    'the',
    'of',
    'to',
    'in',
    'on',
    'for',
    'with',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'this',
    'that',
    'it',
    'as',
    'by',
    'at',
    'from',
    'or',
    'but',
  ]);

  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

export function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

export function clampToMaxSentences(text: string, maxSentences: number): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) {
    return text.trim();
  }
  return sentences.slice(0, maxSentences).join(' ').trim();
}

export function isClarificationAnchored(answer: string, sourceText: string): boolean {
  const answerTokens = new Set(tokenizeMeaningful(answer));
  const sourceTokens = new Set(tokenizeMeaningful(sourceText));
  if (answerTokens.size === 0 || sourceTokens.size === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of answerTokens) {
    if (sourceTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= 2;
}

export function sanitizeClarificationResponse(answer: string, sourceText: string): string {
  const short = clampToMaxSentences(answer, 3);
  if (!isClarificationAnchored(short, sourceText)) {
    return 'I can clarify a specific phrase from this fragment if you point to the exact part that is unclear.';
  }
  return short;
}

export function enforceSingleSentenceHint(hint: string): string {
  const normalized = hint.replace(/\s+/g, ' ').trim();
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const first = (sentences[0] ?? normalized).trim();
  const withoutQuotes = first.replace(/["“”'‘’]/g, '');

  // Keep hint directive and non-generative by preventing obvious template/example wording.
  const cleaned = withoutQuotes
    .replace(/\b(for example|for instance|e\.g\.)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) {
    return 'Focus on one specific claim in this section and explain why it directly supports your thesis.';
  }

  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

export function parseThesisSuggestionLines(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  // Sometimes model returns one paragraph with separators.
  if (lines.length === 1) {
    return lines[0]
      .split(/\s*(?:\||•|;|\n)\s*/)
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter(Boolean);
  }

  return lines;
}

export function normalizeThesisSuggestions(raw: string, topic: string): ThesisSuggestion[] {
  const topicTokens = new Set(tokenizeMeaningful(topic));
  const unique = new Set<string>();
  const accepted: ThesisSuggestion[] = [];
  const lines = parseThesisSuggestionLines(raw);

  for (const line of lines) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 20 || cleaned.length > 280) {
      continue;
    }

    const normalized = cleaned.toLowerCase();
    if (unique.has(normalized)) {
      continue;
    }

    const lineTokens = tokenizeMeaningful(cleaned);
    const overlap = lineTokens.filter((token) => topicTokens.has(token)).length;
    if (topicTokens.size > 0 && overlap === 0) {
      continue;
    }

    unique.add(normalized);
    accepted.push({
      id: `thesis-${accepted.length + 1}`,
      text: cleaned,
    });

    if (accepted.length >= 5) {
      break;
    }
  }

  if (accepted.length >= 3) {
    return accepted;
  }

  const fallback = [
    `This essay argues that ${topic} should be evaluated through conflicting social and ethical priorities rather than a single explanatory lens.`,
    `A stronger interpretation of ${topic} is that its central tension comes from the gap between public ideals and lived outcomes.`,
    `The most defensible claim about ${topic} is that meaningful progress depends on balancing structural constraints with individual agency.`,
  ];

  return fallback.map((text, index) => ({ id: `thesis-${index + 1}`, text }));
}

export function parseJsonObject<T>(raw: string): T | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as T;
    return parsed;
  } catch {
    return null;
  }
}
