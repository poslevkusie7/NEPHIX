import type { ThesisSuggestion } from '@nephix/contracts';

const MEANINGFUL_TOKEN_STOPWORDS = new Set([
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
  'can',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'explain',
  'mean',
  'means',
  'word',
  'phrase',
  'fragment',
  'section',
  'part',
  'context',
  'used',
  'here',
]);

function normalizeToken(token: string): string {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.endsWith('ies') && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('ing') && normalized.length > 5) {
    normalized = normalized.slice(0, -3);
  }
  if (normalized.endsWith('ed') && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  }
  if (normalized.endsWith('al') && normalized.length > 5) {
    normalized = normalized.slice(0, -2);
  }
  if (normalized.endsWith('es') && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  }
  if (normalized.endsWith('s') && normalized.length > 3) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function tokenizeMeaningful(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !MEANINGFUL_TOKEN_STOPWORDS.has(token));
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

  return overlap >= 1;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function selectRelevantSentence(sourceText: string, question: string): string | null {
  const questionTokens = tokenizeMeaningful(question);
  const sentences = splitSentences(sourceText);
  if (sentences.length === 0) {
    return null;
  }

  let bestSentence = sentences[0];
  let bestScore = -1;
  for (const sentence of sentences) {
    const sentenceTokens = new Set(tokenizeMeaningful(sentence));
    const overlap = questionTokens.filter((token) => sentenceTokens.has(token)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestSentence = sentence;
    }
  }

  return truncateText(bestSentence, 180);
}

function extractFocusTerm(question: string): string | null {
  const quoted = question.match(/["“”'‘’]([^"“”'‘’]{2,64})["“”'‘’]/);
  if (quoted?.[1]) {
    const cleanedQuoted = quoted[1].trim().replace(/\s+/g, ' ');
    return cleanedQuoted.length > 1 ? cleanedQuoted : null;
  }

  const parts = question.split(/\s+/);
  for (const part of parts) {
    const cleaned = part.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (cleaned.length < 3) {
      continue;
    }
    if (MEANINGFUL_TOKEN_STOPWORDS.has(cleaned.toLowerCase())) {
      continue;
    }
    return cleaned;
  }

  return null;
}

function buildClarificationFallback(sourceText: string, question: string): string {
  const relevantSentence = selectRelevantSentence(sourceText, question);
  const focus = extractFocusTerm(question);

  if (relevantSentence && focus) {
    return `"${focus}" in this unit means the idea shown in: "${relevantSentence}".`;
  }
  if (relevantSentence) {
    return `Key context line: "${relevantSentence}". Ask about one word and I will define it.`;
  }

  return 'Ask about one specific word, and I will define it in this unit context.';
}

function looksLikeGenericRefusal(answer: string): boolean {
  const lower = answer.toLowerCase();
  return (
    lower.includes('point to the exact part') ||
    lower.includes('point to the exact phrase') ||
    lower.includes('i can clarify a specific phrase') ||
    lower.includes('i can only clarify')
  );
}

export function sanitizeClarificationResponse(
  answer: string,
  sourceText: string,
  question: string,
): string {
  const short = clampToMaxSentences(answer, 3).replace(/\s+/g, ' ').trim();
  if (short.length === 0 || looksLikeGenericRefusal(short)) {
    return buildClarificationFallback(sourceText, question);
  }
  if (!isClarificationAnchored(short, sourceText)) {
    return buildClarificationFallback(sourceText, question);
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
