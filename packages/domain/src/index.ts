import type {
  AssignmentSummaryDTO,
  OutlineSection,
  RevisionIssue,
  UnitType,
} from '@nephix/contracts';

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function sortAssignmentsByDeadline(items: AssignmentSummaryDTO[]): AssignmentSummaryDTO[] {
  return [...items].sort((a, b) => {
    const aDeadline = new Date(a.deadlineISO).getTime();
    const bDeadline = new Date(b.deadlineISO).getTime();
    if (aDeadline !== bDeadline) {
      return aDeadline - bDeadline;
    }

    // Tie-breaker: more completed first, then title to ensure stable output.
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

function looksLikeQuote(sentence: string): boolean {
  const trimmed = sentence.trim();
  return trimmed.startsWith('"') || trimmed.startsWith('“') || trimmed.startsWith('‘');
}

function looksLikeQuestion(sentence: string): boolean {
  return sentence.trim().endsWith('?');
}

function hasTransitionMarker(text: string): boolean {
  const markers = ['however', 'therefore', 'in addition', 'thus', 'moreover', 'consequently'];
  const lower = text.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function buildRevisionIssues(
  sections: Array<{ title: string; text: string; targetWords: number }>,
  targetWordCount: number,
): RevisionIssue[] {
  const issues: RevisionIssue[] = [];
  const total = sections.reduce((acc, section) => acc + countWords(section.text), 0);

  const allowedDelta = Math.round(targetWordCount * 0.1);
  if (Math.abs(total - targetWordCount) > allowedDelta) {
    issues.push({
      code: 'overall_word_count',
      severity: 'high',
      message: `Overall draft is ${total} words; target is ${targetWordCount} (allowed ±10%).`,
    });
  }

  for (const section of sections) {
    const words = countWords(section.text);
    const lowerBound = Math.floor(section.targetWords * 0.8);
    const upperBound = Math.ceil(section.targetWords * 1.2);

    if (words < lowerBound || words > upperBound) {
      issues.push({
        code: 'section_word_balance',
        severity: 'medium',
        message: `${section.title} has ${words} words; target range is ${lowerBound}-${upperBound}.`,
        sectionTitle: section.title,
      });
    }

    const sentences = splitSentences(section.text);
    if (sentences.length > 0 && (looksLikeQuote(sentences[0]) || looksLikeQuestion(sentences[0]))) {
      issues.push({
        code: 'missing_topic_sentence',
        severity: 'medium',
        message: `${section.title} may be missing a direct topic sentence at the start.`,
        sectionTitle: section.title,
      });
    }

    const longSentence = sentences.find((sentence) => countWords(sentence) > 35);
    if (longSentence) {
      issues.push({
        code: 'long_sentence',
        severity: 'low',
        message: `${section.title} includes a sentence longer than 35 words; consider splitting it.`,
        sectionTitle: section.title,
      });
    }

    const quoteHeavyPattern = /"[^"]+"\s*"[^"]+"/;
    if (quoteHeavyPattern.test(section.text)) {
      issues.push({
        code: 'quote_without_analysis',
        severity: 'medium',
        message: `${section.title} has consecutive quotes; add analysis between them.`,
        sectionTitle: section.title,
      });
    }

    if (!hasTransitionMarker(section.text) && sentences.length >= 4) {
      issues.push({
        code: 'weak_transition',
        severity: 'low',
        message: `${section.title} may need clearer transitions to improve flow.`,
        sectionTitle: section.title,
      });
    }
  }

  return issues;
}

export type CompletionInput = {
  unitType: UnitType;
  content: Record<string, unknown> | null | undefined;
};

export function canCompleteUnit({ unitType, content }: CompletionInput): { ok: boolean; reason?: string } {
  const data = content ?? {};

  if (unitType === 'reading') {
    return { ok: true };
  }

  if (unitType === 'thesis') {
    const thesis = typeof data.thesis === 'string' ? data.thesis.trim() : '';
    const confirmed = Boolean(data.confirmed);
    if (!thesis || thesis.length < 10 || !confirmed) {
      return { ok: false, reason: 'Thesis unit requires a confirmed thesis (minimum 10 chars).' };
    }
    return { ok: true };
  }

  if (unitType === 'outline') {
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const confirmed = Boolean(data.confirmed);
    if (sections.length === 0 || !confirmed) {
      return { ok: false, reason: 'Outline unit requires at least one section and confirmation.' };
    }
    return { ok: true };
  }

  if (unitType === 'writing') {
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    const confirmed = Boolean(data.confirmed);
    if (!text || !confirmed) {
      return { ok: false, reason: 'Writing unit requires draft text and confirmation.' };
    }
    return { ok: true };
  }

  if (unitType === 'revise') {
    const confirmed = Boolean(data.confirmed);
    if (!confirmed) {
      return { ok: false, reason: 'Revise unit requires confirmation of revision completion.' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'Unsupported unit type.' };
}
