'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { AssignmentDetailDTO, ThesisSuggestion } from '@nephix/contracts';

type EssayCardShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  noHeaderDivider?: boolean;
};

export function EssayCardShell({
  title: _title,
  subtitle: _subtitle,
  children,
  footer,
  noHeaderDivider = false,
}: EssayCardShellProps) {
  return (
    <section className={`essay-unit-card${noHeaderDivider ? ' no-header-divider' : ''}`}>
      <div className="essay-unit-card-body">{children}</div>
      {footer ? <footer className="essay-unit-card-footer">{footer}</footer> : null}
    </section>
  );
}

export function getSuggestionThemeTag(text: string, index: number): string {
  const normalized = text.toLowerCase();
  if (normalized.includes('social') || normalized.includes('class') || normalized.includes('mobility')) {
    return 'SOCIAL MOBILITY';
  }
  if (normalized.includes('love') || normalized.includes('romantic') || normalized.includes('ruth')) {
    return 'ROMANTIC IDEALIZATION';
  }
  if (normalized.includes('individual') || normalized.includes('independ') || normalized.includes('isolation')) {
    return 'INDIVIDUALISM';
  }
  const fallback = ['AMBITION', 'IDENTITY', 'CONFLICT'];
  return fallback[index % fallback.length];
}

export function getOutlineSectionLabel(title: string, index: number): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('intro')) {
    return 'Introduction';
  }
  if (normalized.includes('conclusion')) {
    return 'Conclusion';
  }
  if (normalized.includes('body') && normalized.includes('1')) {
    return 'Body 1';
  }
  if (normalized.includes('body') && normalized.includes('2')) {
    return 'Body 2';
  }
  if (normalized.includes('body') && normalized.includes('3')) {
    return 'Body 3';
  }
  return `Section ${index + 1}`;
}

export function getOutlineLengthHint(targetWords: number): string {
  if (targetWords > 0) {
    return `~${targetWords} words`;
  }
  return '~150 words';
}

export function getWritingUnitLabel(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('intro')) {
    return 'INTRODUCTION';
  }
  if (normalized.includes('conclusion')) {
    return 'CONCLUSION';
  }
  if (normalized.includes('body') && normalized.includes('1')) {
    return 'BODY PARAGRAPH 1';
  }
  if (normalized.includes('body') && normalized.includes('2')) {
    return 'BODY PARAGRAPH 2';
  }
  if (normalized.includes('body') && normalized.includes('3')) {
    return 'BODY PARAGRAPH 3';
  }
  return title.toUpperCase();
}

export function getWritingUnitLabelForUnit(
  unit: AssignmentDetailDTO['units'][number],
  units: AssignmentDetailDTO['units'],
): string {
  const normalized = getWritingUnitLabel(unit.title);
  if (
    normalized === 'INTRODUCTION' ||
    normalized === 'CONCLUSION' ||
    normalized.startsWith('BODY PARAGRAPH ')
  ) {
    return normalized;
  }

  const writingUnits = units.filter((entry) => entry.unitType === 'writing');
  const writingIndex = writingUnits.findIndex((entry) => entry.id === unit.id);

  if (writingIndex === 0) {
    return 'INTRODUCTION';
  }
  if (writingIndex === writingUnits.length - 1) {
    return 'CONCLUSION';
  }
  if (writingIndex > 0) {
    return `BODY PARAGRAPH ${writingIndex}`;
  }

  return normalized;
}

type ThesisEditorProps = {
  thesis: string;
  suggestions: ThesisSuggestion[];
  busy: boolean;
  disabled: boolean;
  onGenerateIdeas: () => void;
  onSelectSuggestion: (suggestion: ThesisSuggestion) => void;
  onThesisChange: (value: string) => void;
};

export function ThesisEditor({
  thesis,
  suggestions,
  busy,
  disabled,
  onGenerateIdeas,
  onSelectSuggestion,
  onThesisChange,
}: ThesisEditorProps) {
  const hasSuggestions = suggestions.length > 0;

  return (
    <>
      <p className="essay-thesis-suggestions-label">Suggested thesis ideas</p>
      {hasSuggestions ? (
        <div className="essay-thesis-suggestions">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              className={`btn btn-soft suggestion-card${suggestion.text === thesis ? ' selected' : ''}`}
              style={{ textAlign: 'left' }}
              disabled={disabled}
              onClick={() => onSelectSuggestion(suggestion)}
            >
              <div className="suggestion-card-content">
                <span className="suggestion-theme-tag">{getSuggestionThemeTag(suggestion.text, index)}</span>
                <span>{suggestion.text}</span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
      <div className="row mobile-stack essay-thesis-generate-row">
        <button
          type="button"
          className="btn btn-sm button-secondary thesis-generate-btn"
          disabled={disabled || busy}
          onClick={onGenerateIdeas}
        >
          <span className="thesis-generate-icon" aria-hidden="true">↻</span>{' '}
          {busy ? 'Generating...' : hasSuggestions ? 'Generate new ideas' : 'Generate ideas'}
        </button>
      </div>
      <div className="essay-thesis-or-divider" aria-hidden="true">
        <span>— or write your own thesis —</span>
      </div>
      <textarea
        className="essay-thesis-input"
        value={thesis}
        onChange={(event) => onThesisChange(event.target.value)}
        placeholder="Write your thesis in 1-2 sentences..."
        disabled={disabled}
      />
    </>
  );
}

type OutlineSection = {
  id: string;
  title: string;
  guidingQuestion: string;
  targetWords: number;
};

type OutlineEditorProps = {
  sections: OutlineSection[];
  busy: boolean;
  disabled: boolean;
  hasGeneratedOutline: boolean;
  onGenerateOutline: () => void;
  onGuidingQuestionChange: (index: number, value: string) => void;
  onTargetWordsChange: (index: number, value: number) => void;
};

export function OutlineEditor({
  sections,
  busy,
  disabled,
  hasGeneratedOutline,
  onGenerateOutline,
  onGuidingQuestionChange,
  onTargetWordsChange,
}: OutlineEditorProps) {
  const [draftTargetWords, setDraftTargetWords] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const section of sections) {
      next[section.id] = String(section.targetWords);
    }
    setDraftTargetWords(next);
  }, [sections]);

  return (
    <>
      <p className="outline-plan-top-label">Outline sections</p>
      <div className="row mobile-stack outline-generate-row">
        <button
          type="button"
          className="btn btn-sm button-secondary thesis-generate-btn"
          disabled={disabled || busy}
          onClick={onGenerateOutline}
        >
          <span className="thesis-generate-icon" aria-hidden="true">↻</span>{' '}
          {busy ? 'Generating...' : hasGeneratedOutline ? 'Regenerate outline' : 'Generate outline'}
        </button>
      </div>
      <div className="outline-plan-list">
        {sections.map((section, index) => (
          <article key={section.id} className="outline-plan-card">
            <p className="outline-plan-section-label">
              {index + 1}. {getOutlineSectionLabel(section.title, index)}
            </p>
            <input
              className="outline-plan-prompt-input"
              value={section.guidingQuestion}
              onChange={(event) => onGuidingQuestionChange(index, event.target.value)}
              placeholder="Write a guiding question for this section..."
              disabled={disabled}
            />
            <p className="outline-plan-length">
              <input
                className="outline-plan-length-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draftTargetWords[section.id] ?? String(section.targetWords)}
                style={{
                  width: `${Math.max(1, (draftTargetWords[section.id] ?? String(section.targetWords)).length)}ch`,
                }}
                onChange={(event) => {
                  const nextValue = event.target.value.replace(/[^\d]/g, '');
                  setDraftTargetWords((prev) => ({
                    ...prev,
                    [section.id]: nextValue,
                  }));
                  if (nextValue === '') {
                    return;
                  }
                  const value = Number(nextValue);
                  onTargetWordsChange(index, Math.max(0, Number.isFinite(value) ? value : 0));
                }}
                onBlur={() => {
                  const currentValue = draftTargetWords[section.id] ?? String(section.targetWords);
                  if (currentValue !== '') {
                    return;
                  }
                  setDraftTargetWords((prev) => ({
                    ...prev,
                    [section.id]: String(section.targetWords),
                  }));
                }}
                disabled={disabled}
                aria-label={`Target words for ${getOutlineSectionLabel(section.title, index)}`}
              />
              <span className="outline-plan-length-suffix"> words</span>
            </p>
          </article>
        ))}
      </div>
    </>
  );
}

type WritingEditorProps = {
  label: string;
  text: string;
  targetWords: number | null;
  hint: string;
  hintOpen: boolean;
  hintBusy: boolean;
  disabled: boolean;
  hasThesisReminder: boolean;
  selectedThesis?: string;
  thesisReminderOpen: boolean;
  onTextChange: (value: string) => void;
  onToggleThesisReminder: () => void;
  onToggleHint: () => void;
  onRegenerateHint: () => void;
};

export function WritingEditor({
  label,
  text,
  targetWords,
  hint,
  hintOpen,
  hintBusy,
  disabled,
  hasThesisReminder,
  selectedThesis = '',
  thesisReminderOpen,
  onTextChange,
  onToggleThesisReminder,
  onToggleHint,
  onRegenerateHint,
}: WritingEditorProps) {
  return (
    <>
      <div className="writing-unit-header-row">
        <p className="writing-unit-top-label">{label}</p>
        <div className="writing-unit-header-actions">
          {hasThesisReminder ? (
            <div className={`thesis-reminder${thesisReminderOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="btn btn-sm button-secondary thesis-generate-btn thesis-reminder-toggle"
                aria-expanded={thesisReminderOpen}
                onClick={onToggleThesisReminder}
              >
                <span>Thesis reminder</span>{' '}
                <span className={`thesis-reminder-caret${thesisReminderOpen ? ' open' : ''}`} aria-hidden="true">
                  ▾
                </span>
              </button>
            </div>
          ) : null}
          <div className="row mobile-stack writing-hint-row">
            <button
              type="button"
              className="btn btn-sm button-secondary thesis-generate-btn"
              disabled={disabled || hintBusy}
              onClick={onToggleHint}
            >
              <span className="writing-hint-icon" aria-hidden="true">+</span>{' '}
              {hintBusy ? 'Generating...' : hint ? (hintOpen ? 'Hide hint' : 'Show hint') : 'Suggest a hint'}
            </button>
          </div>
        </div>
      </div>
      {hasThesisReminder ? (
        <div className={`thesis-reminder thesis-reminder-panel${thesisReminderOpen ? ' open' : ''}`}>
          <div className="thesis-reminder-content" aria-hidden={!thesisReminderOpen}>
            <div className="writing-hint-panel thesis-reminder-surface">
              <p className="writing-hint-label">Thesis</p>
              <p className="thesis-reminder-text">{selectedThesis || 'No thesis selected yet.'}</p>
            </div>
          </div>
        </div>
      ) : null}
      {hint ? (
        <div className={`thesis-reminder thesis-reminder-panel writing-hint-collapse${hintOpen ? ' open' : ''}`}>
          <div className="thesis-reminder-content" aria-hidden={!hintOpen}>
            <div
              className="writing-hint-panel thesis-reminder-surface"
              onDoubleClick={onRegenerateHint}
              title="Double-click to regenerate hint"
            >
              <p className="writing-hint-label">Hint</p>
              <p className="writing-hint-text">{hint}</p>
            </div>
          </div>
        </div>
      ) : null}
      <textarea
        className="writing-unit-textarea"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        disabled={disabled}
        placeholder="Start drafting this section..."
      />
      <p className="writing-unit-counter">
        {text.trim().split(/\s+/).filter(Boolean).length} / {typeof targetWords === 'number' ? targetWords : 150} words
      </p>
    </>
  );
}

type RevisionEditorProps = {
  draft: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onAnalyze: () => void;
  analyzeLabel: string;
};

export function RevisionEditor({
  draft,
  disabled,
  onDraftChange,
  onAnalyze,
  analyzeLabel,
}: RevisionEditorProps) {
  return (
    <>
      <p className="writing-unit-top-label">REVISION</p>
      <label className="field revise-draft-field">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          disabled={disabled}
          className="revise-draft-textarea"
        />
      </label>
      <div className="row revise-analyze-row">
        <button
          type="button"
          className="btn button-secondary thesis-generate-btn"
          onClick={onAnalyze}
          disabled={disabled}
        >
          {analyzeLabel}
        </button>
      </div>
    </>
  );
}
