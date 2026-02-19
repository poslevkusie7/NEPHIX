import { buildRevisionPasses, canCompleteUnit, sortAssignmentsByDeadline } from '@nephix/domain';

describe('sortAssignmentsByDeadline', () => {
  it('orders by nearest deadline first when deadlines are materially different', () => {
    const sorted = sortAssignmentsByDeadline(
      [
        {
          id: 'b',
          title: 'Later assignment',
          subject: 'History',
          taskType: 'reading',
          deadlineISO: '2026-03-01T00:00:00.000Z',
          status: 'not_started',
          currentUnitId: null,
          totalUnits: 3,
          completedUnits: 0,
        },
        {
          id: 'a',
          title: 'Soon assignment',
          subject: 'Literature',
          taskType: 'essay',
          deadlineISO: '2026-02-12T00:00:00.000Z',
          status: 'in_progress',
          currentUnitId: 'u1',
          totalUnits: 4,
          completedUnits: 2,
        },
      ],
      {
        preferenceScores: new Map([
          ['a', 1],
          ['b', 100],
        ]),
      },
    );

    expect(sorted[0]?.id).toBe('a');
    expect(sorted[1]?.id).toBe('b');
  });

  it('applies preference tie-break for comparable deadlines', () => {
    const sorted = sortAssignmentsByDeadline(
      [
        {
          id: 'a',
          title: 'Soon assignment',
          subject: 'Literature',
          taskType: 'essay',
          deadlineISO: '2026-02-12T00:00:00.000Z',
          status: 'in_progress',
          currentUnitId: 'u1',
          totalUnits: 4,
          completedUnits: 2,
        },
        {
          id: 'b',
          title: 'Comparable assignment',
          subject: 'History',
          taskType: 'reading',
          deadlineISO: '2026-02-13T00:00:00.000Z',
          status: 'not_started',
          currentUnitId: null,
          totalUnits: 3,
          completedUnits: 0,
        },
      ],
      {
        comparableDeadlineWindowMs: 48 * 60 * 60 * 1000,
        preferenceScores: new Map([
          ['a', 1],
          ['b', 100],
        ]),
      },
    );

    expect(sorted[0]?.id).toBe('b');
    expect(sorted[1]?.id).toBe('a');
  });
});

describe('canCompleteUnit', () => {
  it('requires thesis text and explicit confirmation for thesis unit', () => {
    const rejected = canCompleteUnit({
      unitType: 'thesis',
      content: { thesis: 'This thesis is long enough for completion.' },
    });

    const accepted = canCompleteUnit({
      unitType: 'thesis',
      content: { thesis: 'This thesis is long enough for completion.', confirmed: true },
    });

    expect(rejected.ok).toBe(false);
    expect(accepted.ok).toBe(true);
  });

  it('accepts reading units without content', () => {
    const accepted = canCompleteUnit({
      unitType: 'reading',
      content: null,
    });

    expect(accepted.ok).toBe(true);
  });

  it('requires confirmation for outline units', () => {
    const rejected = canCompleteUnit({
      unitType: 'outline',
      content: {
        sections: [{ id: 'intro', title: 'Intro', guidingQuestion: 'Why now?', targetWords: 100 }],
      },
    });
    const accepted = canCompleteUnit({
      unitType: 'outline',
      content: {
        sections: [{ id: 'intro', title: 'Intro', guidingQuestion: 'Why now?', targetWords: 100 }],
        confirmed: true,
      },
    });

    expect(rejected.ok).toBe(false);
    expect(accepted.ok).toBe(true);
  });

  it('requires confirmation for writing units', () => {
    const rejected = canCompleteUnit({
      unitType: 'writing',
      content: { text: 'This is a complete draft paragraph for the section.' },
    });
    const accepted = canCompleteUnit({
      unitType: 'writing',
      content: { text: 'This is a complete draft paragraph for the section.', confirmed: true },
    });

    expect(rejected.ok).toBe(false);
    expect(accepted.ok).toBe(true);
  });

  it('requires confirmation for revise units', () => {
    const rejected = canCompleteUnit({
      unitType: 'revise',
      content: { revisionText: 'Final revised draft.' },
    });
    const accepted = canCompleteUnit({
      unitType: 'revise',
      content: { revisionText: 'Final revised draft.', confirmed: true },
    });

    expect(rejected.ok).toBe(false);
    expect(accepted.ok).toBe(true);
  });
});

describe('buildRevisionPasses', () => {
  it('returns seven pass groups with stable ids', () => {
    const passes = buildRevisionPasses(
      [
        {
          title: 'Body 1',
          text: 'This paragraph shows a claim. It needs stronger support.',
          targetWords: 120,
        },
      ],
      300,
      { thesis: 'The essay argues that claims need evidence.' },
    );

    expect(passes).toHaveLength(7);
    expect(passes[0]?.passId).toBe('pass_1_thesis_focus');
    expect(passes[6]?.passId).toBe('pass_7_mechanics');
  });
});
