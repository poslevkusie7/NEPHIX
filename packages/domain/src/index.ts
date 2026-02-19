import type {
  AssignmentSummaryDTO,
  OutlineSection,
  RevisionIssue,
  RevisionIssueActionStatus,
  RevisionPassResult,
  UnitType,
} from '@nephix/contracts';

const DEFAULT_COMPARABLE_DEADLINE_WINDOW_MS = 48 * 60 * 60 * 1000;

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

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
    'into',
    'about',
  ]);

  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !stopwords.has(token));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function looksLikeQuote(sentence: string): boolean {
  const trimmed = sentence.trim();
  return trimmed.startsWith('"') || trimmed.startsWith('“') || trimmed.startsWith('‘');
}

function looksLikeQuestion(sentence: string): boolean {
  return sentence.trim().endsWith('?');
}

function startsWithEvidenceMarker(sentence: string): boolean {
  const markers = [
    'for example',
    'for instance',
    'according to',
    'as shown in',
    'evidence shows',
    'research shows',
  ];
  const lower = sentence.toLowerCase().trim();
  return markers.some((marker) => lower.startsWith(marker));
}

function hasTransitionMarker(text: string): boolean {
  const markers = [
    'however',
    'therefore',
    'in addition',
    'thus',
    'moreover',
    'consequently',
    'meanwhile',
    'nevertheless',
  ];
  const lower = text.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function hasEvidenceMarker(text: string): boolean {
  const markers = ['for example', 'for instance', 'according to', 'evidence', 'data', 'study', 'quote'];
  const lower = text.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function countUnmatched(text: string, char: string): number {
  return (text.match(new RegExp(`\\${char}`, 'g')) ?? []).length;
}

function hasUnbalancedParentheses(text: string): boolean {
  let balance = 0;
  for (const char of text) {
    if (char === '(') {
      balance += 1;
    } else if (char === ')') {
      balance -= 1;
      if (balance < 0) {
        return true;
      }
    }
  }
  return balance !== 0;
}

function buildIssue(
  passId: string,
  code: string,
  severity: 'low' | 'medium' | 'high',
  message: string,
  sectionTitle?: string,
  actionStatus: RevisionIssueActionStatus = 'open',
): RevisionIssue {
  return {
    code,
    severity,
    message,
    sectionTitle,
    passId,
    actionStatus,
  };
}

function resolvePreferenceScore(
  item: AssignmentSummaryDTO,
  preferenceScores?: Map<string, number> | Record<string, number | undefined>,
): number {
  if (!preferenceScores) {
    return 0;
  }

  if (preferenceScores instanceof Map) {
    return preferenceScores.get(item.id) ?? 0;
  }

  return preferenceScores[item.id] ?? 0;
}

export function sortAssignmentsByDeadline(
  items: AssignmentSummaryDTO[],
  options?: {
    comparableDeadlineWindowMs?: number;
    preferenceScores?: Map<string, number> | Record<string, number | undefined>;
  },
): AssignmentSummaryDTO[] {
  const comparableWindow = options?.comparableDeadlineWindowMs ?? DEFAULT_COMPARABLE_DEADLINE_WINDOW_MS;

  return [...items].sort((a, b) => {
    const aDeadline = new Date(a.deadlineISO).getTime();
    const bDeadline = new Date(b.deadlineISO).getTime();
    const deadlineDelta = aDeadline - bDeadline;
    const absDelta = Math.abs(deadlineDelta);

    if (absDelta > comparableWindow) {
      return deadlineDelta;
    }

    const aPreference = resolvePreferenceScore(a, options?.preferenceScores);
    const bPreference = resolvePreferenceScore(b, options?.preferenceScores);
    if (aPreference !== bPreference) {
      return bPreference - aPreference;
    }

    if (deadlineDelta !== 0) {
      return deadlineDelta;
    }

    const aProgress = a.totalUnits === 0 ? 0 : a.completedUnits / a.totalUnits;
    const bProgress = b.totalUnits === 0 ? 0 : b.completedUnits / b.totalUnits;
    if (aProgress !== bProgress) {
      return bProgress - aProgress;
    }

    return a.title.localeCompare(b.title);
  });
}

export function buildInitialOutline(wordCount: number): OutlineSection[] {
  const safeWordCount = Math.max(wordCount, 250);
  const intro = Math.round(safeWordCount * 0.15);
  const bodyOne = Math.round(safeWordCount * 0.25);
  const bodyTwo = Math.round(safeWordCount * 0.25);
  const bodyThree = Math.round(safeWordCount * 0.2);
  const conclusion = safeWordCount - intro - bodyOne - bodyTwo - bodyThree;

  return [
    {
      id: 'intro',
      title: 'Introduction',
      guidingQuestion: 'How will you introduce the topic and thesis?',
      targetWords: intro,
    },
    {
      id: 'body-1',
      title: 'Body Paragraph 1',
      guidingQuestion: 'What is your strongest first argument?',
      targetWords: bodyOne,
    },
    {
      id: 'body-2',
      title: 'Body Paragraph 2',
      guidingQuestion: 'What argument or evidence deepens your thesis?',
      targetWords: bodyTwo,
    },
    {
      id: 'body-3',
      title: 'Body Paragraph 3',
      guidingQuestion: 'What perspective or counterpoint should be addressed?',
      targetWords: bodyThree,
    },
    {
      id: 'conclusion',
      title: 'Conclusion',
      guidingQuestion: 'How do you reinforce your thesis and close with impact?',
      targetWords: conclusion,
    },
  ];
}

type RevisionSection = {
  title: string;
  text: string;
  targetWords: number;
};

export function buildRevisionPasses(
  sections: RevisionSection[],
  targetWordCount: number,
  options?: { thesis?: string },
): RevisionPassResult[] {
  const pass1Id = 'pass_1_thesis_focus';
  const pass2Id = 'pass_2_structure';
  const pass3Id = 'pass_3_argument_evidence';
  const pass4Id = 'pass_4_flow_cohesion';
  const pass5Id = 'pass_5_style_clarity';
  const pass6Id = 'pass_6_word_balance';
  const pass7Id = 'pass_7_mechanics';

  const pass1Issues: RevisionIssue[] = [];
  const thesisTokens = new Set(tokenizeMeaningful(options?.thesis ?? ''));
  if (thesisTokens.size > 0) {
    for (const section of sections) {
      const sentences = splitSentences(section.text);
      if (sentences.length === 0) {
        continue;
      }

      const firstSentence = sentences[0];
      if (startsWithEvidenceMarker(firstSentence)) {
        continue;
      }

      const sectionTokens = tokenizeMeaningful(firstSentence);
      const overlap = sectionTokens.filter((token) => thesisTokens.has(token)).length;
      if (overlap === 0) {
        pass1Issues.push(
          buildIssue(
            pass1Id,
            'thesis_connection',
            'medium',
            `${section.title} may not connect clearly to the thesis focus.`,
            section.title,
          ),
        );
      }
    }
  }

  const pass2Issues: RevisionIssue[] = [];
  for (const section of sections) {
    const sentences = splitSentences(section.text);
    if (sentences.length > 0 && (looksLikeQuote(sentences[0]) || looksLikeQuestion(sentences[0]))) {
      pass2Issues.push(
        buildIssue(
          pass2Id,
          'missing_topic_sentence',
          'medium',
          `${section.title} may be missing a direct topic sentence at the start.`,
          section.title,
        ),
      );
    }

    const quoteHeavyPattern = /"[^"]+"\s*"[^"]+"/;
    if (quoteHeavyPattern.test(section.text)) {
      pass2Issues.push(
        buildIssue(
          pass2Id,
          'quote_without_analysis',
          'medium',
          `${section.title} has consecutive quotes; add analysis between them.`,
          section.title,
        ),
      );
    }

    if (sentences.length >= 4 && !hasTransitionMarker(sentences[sentences.length - 1] ?? '')) {
      pass2Issues.push(
        buildIssue(
          pass2Id,
          'missing_closing_transition',
          'low',
          `${section.title} may need a clearer closing transition sentence.`,
          section.title,
        ),
      );
    }
  }

  const pass3Issues: RevisionIssue[] = [];
  const strongClaimPattern = /\b(shows|proves|demonstrates|leads to|indicates|reveals)\b/i;
  for (const section of sections) {
    if (strongClaimPattern.test(section.text) && !hasEvidenceMarker(section.text)) {
      pass3Issues.push(
        buildIssue(
          pass3Id,
          'claim_without_evidence',
          'medium',
          `${section.title} includes strong claims without clear evidence markers.`,
          section.title,
        ),
      );
    }

    const quoteHeavyPattern = /"[^"]+"\s*"[^"]+"/;
    if (quoteHeavyPattern.test(section.text)) {
      pass3Issues.push(
        buildIssue(
          pass3Id,
          'stacked_quotes',
          'medium',
          `${section.title} contains consecutive quotes without analysis.`,
          section.title,
        ),
      );
    }
  }

  const pass4Issues: RevisionIssue[] = [];
  for (const section of sections) {
    const sentences = splitSentences(section.text);
    const longSentence = sentences.find((sentence) => countWords(sentence) > 35);
    if (longSentence) {
      pass4Issues.push(
        buildIssue(
          pass4Id,
          'long_sentence',
          'low',
          `${section.title} includes a sentence longer than 35 words; consider splitting it.`,
          section.title,
        ),
      );
    }

    if (!hasTransitionMarker(section.text) && sentences.length >= 4) {
      pass4Issues.push(
        buildIssue(
          pass4Id,
          'weak_transition',
          'low',
          `${section.title} may need clearer transitions to improve flow.`,
          section.title,
        ),
      );
    }
  }

  const pass5Issues: RevisionIssue[] = [];
  const fillerPhrases = ['in general', 'it should be noted', 'actually', 'basically', 'very'];
  const passiveVoicePattern = /\b(was|were|is|are|been|be)\s+\w+ed\b/i;
  const repeatedWordPattern = /\b(\w+)\s+\1\b/i;
  for (const section of sections) {
    const lower = section.text.toLowerCase();
    if (fillerPhrases.some((phrase) => lower.includes(phrase))) {
      pass5Issues.push(
        buildIssue(
          pass5Id,
          'filler_phrase',
          'low',
          `${section.title} contains filler phrasing; simplify wording for clarity.`,
          section.title,
        ),
      );
    }

    if (passiveVoicePattern.test(section.text)) {
      pass5Issues.push(
        buildIssue(
          pass5Id,
          'passive_voice',
          'low',
          `${section.title} may rely on passive voice; consider active phrasing.`,
          section.title,
        ),
      );
    }

    if (repeatedWordPattern.test(section.text)) {
      pass5Issues.push(
        buildIssue(
          pass5Id,
          'repeated_word',
          'low',
          `${section.title} repeats words closely; revise for variety and clarity.`,
          section.title,
        ),
      );
    }
  }

  const pass6Issues: RevisionIssue[] = [];
  const total = sections.reduce((acc, section) => acc + countWords(section.text), 0);
  const allowedDelta = Math.round(targetWordCount * 0.1);
  if (Math.abs(total - targetWordCount) > allowedDelta) {
    pass6Issues.push(
      buildIssue(
        pass6Id,
        'overall_word_count',
        'high',
        `Overall draft is ${total} words; target is ${targetWordCount} (allowed ±10%).`,
      ),
    );
  }

  for (const section of sections) {
    const words = countWords(section.text);
    const lowerBound = Math.floor(section.targetWords * 0.8);
    const upperBound = Math.ceil(section.targetWords * 1.2);
    if (words < lowerBound || words > upperBound) {
      pass6Issues.push(
        buildIssue(
          pass6Id,
          'section_word_balance',
          'medium',
          `${section.title} has ${words} words; target range is ${lowerBound}-${upperBound}.`,
          section.title,
        ),
      );
    }
  }

  const pass7Issues: RevisionIssue[] = [];
  for (const section of sections) {
    if (section.text.includes('  ')) {
      pass7Issues.push(
        buildIssue(
          pass7Id,
          'double_space',
          'low',
          `${section.title} contains double spaces.`,
          section.title,
        ),
      );
    }

    if (repeatedWordPattern.test(section.text)) {
      pass7Issues.push(
        buildIssue(
          pass7Id,
          'duplicate_word',
          'low',
          `${section.title} contains duplicate adjacent words.`,
          section.title,
        ),
      );
    }

    const quoteCount = countUnmatched(section.text, '"');
    if (quoteCount % 2 !== 0 || hasUnbalancedParentheses(section.text)) {
      pass7Issues.push(
        buildIssue(
          pass7Id,
          'punctuation_consistency',
          'medium',
          `${section.title} may contain punctuation inconsistencies (quotes/parentheses).`,
          section.title,
        ),
      );
    }
  }

  return [
    { passId: pass1Id, passTitle: 'Pass 1 — Thesis & Focus', issues: pass1Issues },
    { passId: pass2Id, passTitle: 'Pass 2 — Structure (TREE)', issues: pass2Issues },
    { passId: pass3Id, passTitle: 'Pass 3 — Argument & Evidence', issues: pass3Issues },
    { passId: pass4Id, passTitle: 'Pass 4 — Flow & Cohesion', issues: pass4Issues },
    { passId: pass5Id, passTitle: 'Pass 5 — Style & Clarity', issues: pass5Issues },
    { passId: pass6Id, passTitle: 'Pass 6 — Word Count & Balance', issues: pass6Issues },
    { passId: pass7Id, passTitle: 'Pass 7 — Mechanics', issues: pass7Issues },
  ];
}

export function buildRevisionIssues(
  sections: RevisionSection[],
  targetWordCount: number,
  options?: { thesis?: string },
): RevisionIssue[] {
  return buildRevisionPasses(sections, targetWordCount, options).flatMap((pass) => pass.issues);
}

export type CompletionInput = {
  unitType: UnitType;
  content: Record<string, unknown> | null | undefined;
};

function isConfirmed(content: Record<string, unknown>): boolean {
  return Boolean(content.confirmed);
}

export function canCompleteUnit({ unitType, content }: CompletionInput): { ok: boolean; reason?: string } {
  const data = content ?? {};

  if (unitType === 'reading') {
    return { ok: true };
  }

  if (unitType === 'thesis') {
    const thesis = typeof data.thesis === 'string' ? data.thesis.trim() : '';
    if (!thesis || thesis.length < 10) {
      return { ok: false, reason: 'Thesis unit requires a thesis statement (minimum 10 chars).' };
    }
    if (!isConfirmed(data)) {
      return { ok: false, reason: 'Thesis unit requires explicit confirmation.' };
    }
    return { ok: true };
  }

  if (unitType === 'outline') {
    const sections = Array.isArray(data.sections) ? data.sections : [];
    if (sections.length === 0) {
      return { ok: false, reason: 'Outline unit requires at least one section.' };
    }
    if (!isConfirmed(data)) {
      return { ok: false, reason: 'Outline unit requires explicit confirmation.' };
    }
    return { ok: true };
  }

  if (unitType === 'writing') {
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) {
      return { ok: false, reason: 'Writing unit requires draft text.' };
    }
    if (!isConfirmed(data)) {
      return { ok: false, reason: 'Writing unit requires explicit confirmation.' };
    }
    return { ok: true };
  }

  if (unitType === 'revise') {
    if (!isConfirmed(data)) {
      return { ok: false, reason: 'Revise unit requires explicit confirmation.' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'Unsupported unit type.' };
}
