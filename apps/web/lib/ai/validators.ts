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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

const BROAD_SCOPE_PATTERNS: RegExp[] = [
  /\bsummar(?:y|ize|ise|ized|ised)\b/i,
  /\bmain idea\b/i,
  /\boverview\b/i,
  /\bexplain\b.*\b(fragment|text|passage|paragraph|section|chapter|whole|entire)\b/i,
  /\bwhat is (this|it) about\b/i,
  /\brewrite\b/i,
  /\bwrite me\b/i,
  /\bessay\b/i,
];

function cleanInputText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractQuotedTerm(message: string): string | null {
  const match = message.match(/["'`]([^"'`]{1,64})["'`]/);
  if (!match?.[1]) {
    return null;
  }
  return cleanInputText(match[1]);
}

function parseCandidateTerm(rawMessage: string): string | null {
  const message = cleanInputText(rawMessage);
  if (!message) {
    return null;
  }
  if (BROAD_SCOPE_PATTERNS.some((pattern) => pattern.test(message))) {
    return null;
  }

  const quoted = extractQuotedTerm(message);
  if (quoted) {
    return quoted;
  }

  const patterns = [
    /^what does\s+(.+?)\s+mean\??$/i,
    /^what is the meaning of\s+(.+?)\??$/i,
    /^meaning of\s+(.+?)\??$/i,
    /^define\s+(.+?)\??$/i,
    /^definition of\s+(.+?)\??$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return cleanInputText(match[1]);
    }
  }

  return message;
}

function normalizeCandidateTerm(rawCandidate: string): string | null {
  const candidate = cleanInputText(rawCandidate)
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    .replace(/[?!.,]+$/g, '')
    .trim();

  if (!candidate) {
    return null;
  }
  if (/[\n\r]/.test(candidate)) {
    return null;
  }
  if (/[;:()[\]{}]/.test(candidate)) {
    return null;
  }

  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) {
    return null;
  }
  if (candidate.length > 64) {
    return null;
  }

  const meaningfulWordCount = words
    .map((word) => normalizeToken(word))
    .filter((word) => word.length > 2 && !MEANINGFUL_TOKEN_STOPWORDS.has(word)).length;
  if (meaningfulWordCount === 0) {
    return null;
  }

  return candidate;
}

export function extractDefinitionTarget(message: string): string | null {
  const candidate = parseCandidateTerm(message);
  if (!candidate) {
    return null;
  }
  return normalizeCandidateTerm(candidate);
}

export function isDefinitionTargetInSource(sourceText: string, target: string): boolean {
  const escapedTarget = escapeRegExp(target).replace(/\s+/g, '\\s+');
  const direct = new RegExp(`\\b${escapedTarget}\\b`, 'i');
  if (direct.test(sourceText)) {
    return true;
  }

  const normalizedTargetWords = target
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  const normalizedSourceWords = sourceText
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  if (normalizedTargetWords.length === 0 || normalizedSourceWords.length === 0) {
    return false;
  }

  if (normalizedTargetWords.length === 1) {
    return normalizedSourceWords.includes(normalizedTargetWords[0]);
  }

  for (let index = 0; index <= normalizedSourceWords.length - normalizedTargetWords.length; index += 1) {
    let allMatch = true;
    for (let offset = 0; offset < normalizedTargetWords.length; offset += 1) {
      if (normalizedSourceWords[index + offset] !== normalizedTargetWords[offset]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return true;
    }
  }
  return false;
}

function parseJsonDefinition(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { definition?: unknown };
    return typeof parsed.definition === 'string' ? cleanInputText(parsed.definition) : null;
  } catch {
    return null;
  }
}

function ensureTrailingPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function looksLikeSummaryResponse(text: string, sourceText: string): boolean {
  const lower = text.toLowerCase();
  const bannedPhrases = [
    'in this unit',
    'in this fragment',
    'key context line',
    'idea shown in',
    'the text says',
    'this sentence',
    'this line',
  ];
  if (bannedPhrases.some((phrase) => lower.includes(phrase))) {
    return true;
  }

  const compact = cleanInputText(text);
  if (compact.split(/\s+/).length > 24) {
    return true;
  }

  const sourceSentences = splitSentences(sourceText);
  for (const sentence of sourceSentences) {
    const probe = sentence.toLowerCase().slice(0, 48);
    if (probe.length >= 24 && lower.includes(probe)) {
      return true;
    }
  }

  return false;
}

function buildDefinitionFallback(target: string): string {
  return `${target}: definition unavailable. Ask with one word from this reading text.`;
}

export function sanitizeClarificationResponse(
  answer: string,
  sourceText: string,
  question: string,
): string {
  const target = extractDefinitionTarget(question);
  if (!target) {
    return 'Ask for one word or a short phrase from the reading text.';
  }

  const parsedJson = parseJsonDefinition(answer ?? '');
  const raw = cleanInputText(parsedJson ?? answer ?? '');
  if (!raw || /term_not_found/i.test(raw)) {
    return buildDefinitionFallback(target);
  }

  let single = clampToMaxSentences(raw, 1).replace(/\s+/g, ' ').trim();
  single = single.replace(/^[`"' ]+|[`"' ]+$/g, '').trim();
  single = single.replace(/["'`]([^"'`]{30,})["'`]/g, '').trim();
  if (!single) {
    return buildDefinitionFallback(target);
  }

  const escapedTarget = escapeRegExp(target);
  const definition = single
    .replace(new RegExp(`^${escapedTarget}\\s*[:\\-–]\\s*`, 'i'), '')
    .replace(new RegExp(`^${escapedTarget}\\s+(means|is|refers to)\\s+`, 'i'), '')
    .replace(/^(it|this|that)\s+(means|is|refers to)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!definition) {
    return buildDefinitionFallback(target);
  }

  if (looksLikeSummaryResponse(definition, sourceText)) {
    return buildDefinitionFallback(target);
  }

  return `${target}: ${ensureTrailingPeriod(definition)}`;
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
