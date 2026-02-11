import { canCompleteUnit, sortAssignmentsByDeadline } from '@nephix/domain';

describe('sortAssignmentsByDeadline', () => {
  it('orders by nearest deadline first', () => {
    const sorted = sortAssignmentsByDeadline([
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
    ]);

    expect(sorted[0]?.id).toBe('a');
    expect(sorted[1]?.id).toBe('b');
  });
});

describe('canCompleteUnit', () => {
  it('requires thesis text length for thesis unit', () => {
    const rejected = canCompleteUnit({
      unitType: 'thesis',
      content: { thesis: 'Too short' },
    });

    const accepted = canCompleteUnit({
      unitType: 'thesis',
      content: { thesis: 'This thesis is long enough for completion.' },
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

  it('accepts outline units with sections without confirmation', () => {
    const accepted = canCompleteUnit({
      unitType: 'outline',
      content: {
        sections: [{ id: 'intro', title: 'Intro', guidingQuestion: 'Why now?', targetWords: 100 }],
      },
    });

    expect(accepted.ok).toBe(true);
  });

  it('accepts writing units with draft text only', () => {
    const accepted = canCompleteUnit({
      unitType: 'writing',
      content: { text: 'This is a complete draft paragraph for the section.' },
    });

    expect(accepted.ok).toBe(true);
  });

  it('accepts revise units without confirmation', () => {
    const accepted = canCompleteUnit({
      unitType: 'revise',
      content: { revisionText: 'Final revised draft.' },
    });

    expect(accepted.ok).toBe(true);
  });
});
