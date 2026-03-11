'use client';

import { useRouter } from 'next/navigation';
import {
  type ReactNode,
  WheelEvent as ReactWheelEvent,
  forwardRef,
  PointerEvent as ReactPointerEvent,
  UIEvent as ReactUIEvent,
  useImperativeHandle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AssignmentDetailDTO,
  AssignmentStateDTO,
  AssignmentSummaryDTO,
  BookmarkUnitRequest,
  ClarificationTurn,
  CompleteUnitResponse,
  PatchUnitStateRequest,
  RevisionIssue,
  ThesisSuggestion,
  UserUnitStateDTO,
} from '@nephix/contracts';

type StudyClientProps = {
  initialAssignmentId?: string | null;
  initialUnitId?: string | null;
};

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSwipeIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      'button, input, textarea, select, option, label, a, summary, [role="button"], [data-no-swipe="true"]',
    ),
  );
}

type SwipeHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
};

type UnitWorkspaceHandle = {
  persist: () => Promise<boolean>;
};

type EssayCardShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  noHeaderDivider?: boolean;
};

function EssayCardShell({ title: _title, subtitle: _subtitle, children, footer, noHeaderDivider = false }: EssayCardShellProps) {
  return (
    <section className={`essay-unit-card${noHeaderDivider ? ' no-header-divider' : ''}`}>
      <div className="essay-unit-card-body">{children}</div>
      {footer ? <footer className="essay-unit-card-footer">{footer}</footer> : null}
    </section>
  );
}

function getEssayStepLabel(unit: AssignmentDetailDTO['units'][number]): string {
  if (unit.unitType === 'thesis') {
    return 'Thesis';
  }
  if (unit.unitType === 'outline') {
    return 'Outline';
  }
  if (unit.unitType === 'revise') {
    return 'Revise';
  }
  if (unit.unitType === 'writing') {
    const title = unit.title.toLowerCase();
    if (title.includes('intro')) {
      return 'Intro';
    }
    if (title.includes('conclusion')) {
      return 'Conclusion';
    }
    if (title.includes('body') && title.includes('1')) {
      return 'Body 1';
    }
    if (title.includes('body') && title.includes('2')) {
      return 'Body 2';
    }
    if (title.includes('body') && title.includes('3')) {
      return 'Body 3';
    }
    return 'Writing';
  }
  return unit.title;
}

function getSuggestionThemeTag(text: string, index: number): string {
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

function getOutlineSectionLabel(title: string, index: number): string {
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

function getOutlineLengthHint(targetWords: number): string {
  if (targetWords > 0) {
    return `~${targetWords} words`;
  }
  return '~150 words';
}

function getWritingUnitLabel(title: string): string {
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

type RevisionFocus = 'clarity' | 'structure' | 'argument' | 'style';

function useSwipeNavigation(callbacks: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}): SwipeHandlers {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const currentRef = useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    startRef.current = null;
    currentRef.current = null;
  };

  return {
    onPointerDown: (event) => {
      if (isSwipeIgnoredTarget(event.target)) {
        reset();
        return;
      }

      startRef.current = { x: event.clientX, y: event.clientY };
      currentRef.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      if (!startRef.current) {
        return;
      }
      currentRef.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: () => {
      if (!startRef.current || !currentRef.current) {
        reset();
        return;
      }

      const dx = currentRef.current.x - startRef.current.x;
      const dy = currentRef.current.y - startRef.current.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const threshold = 60;

      if (absX > absY && absX > threshold) {
        if (dx < 0) {
          callbacks.onSwipeLeft?.();
        } else {
          callbacks.onSwipeRight?.();
        }
      }

      if (absY > absX && absY > threshold) {
        if (dy < 0) {
          callbacks.onSwipeUp?.();
        } else {
          callbacks.onSwipeDown?.();
        }
      }

      reset();
    },
    onPointerCancel: () => {
      reset();
    },
  };
}

export function StudyClient({
  initialAssignmentId = null,
  initialUnitId = null,
}: StudyClientProps) {
  const router = useRouter();
  const requestedAssignmentId = initialAssignmentId;
  const requestedUnitId = initialUnitId;
  const requestedSelectionKey = `${requestedAssignmentId ?? ''}::${requestedUnitId ?? ''}`;

  const [feed, setFeed] = useState<AssignmentSummaryDTO[]>([]);
  const [currentAssignmentId, setCurrentAssignmentId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [viewUnitId, setViewUnitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReadingChatOpen, setIsReadingChatOpen] = useState(false);
  const [readingChatUnitId, setReadingChatUnitId] = useState<string | null>(null);
  const [readingChatMessage, setReadingChatMessage] = useState('');
  const [readingChatTurns, setReadingChatTurns] = useState<ClarificationTurn[]>([]);
  const [readingChatLoading, setReadingChatLoading] = useState(false);
  const [readingChatBusy, setReadingChatBusy] = useState(false);
  const [readingChatError, setReadingChatError] = useState<string | null>(null);
  const workspaceRef = useRef<UnitWorkspaceHandle | null>(null);
  const navigationInFlightRef = useRef(false);
  const appliedRequestedSelectionRef = useRef<string | null>(null);
  const readingChatScrollRef = useRef<HTMLDivElement | null>(null);
  const moveAssignmentRef = useRef<(delta: number) => Promise<void>>(async () => undefined);
  const moveUnitRef = useRef<(delta: number) => Promise<void>>(async () => undefined);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      let response = await fetch(path, init);
      if (response.status === 401) {
        const refresh = await fetch('/api/auth/refresh', { method: 'POST' });
        if (refresh.ok) {
          response = await fetch(path, init);
        }
      }

      if (response.status === 401) {
        router.push('/login');
        throw new Error('Session expired. Please login again.');
      }

      return response;
    },
    [router],
  );

  const loadFeed = useCallback(async () => {
    const response = await apiFetch('/api/feed');
    if (!response.ok) {
      throw new Error('Failed to load feed.');
    }

    const body = (await response.json()) as { feed: AssignmentSummaryDTO[] };
    setFeed(body.feed);
    setCurrentAssignmentId((prev) => prev ?? body.feed[0]?.id ?? null);
  }, [apiFetch]);

  const loadAssignmentBundle = useCallback(
    async (assignmentId: string) => {
      const [assignmentResponse, stateResponse] = await Promise.all([
        apiFetch(`/api/assignments/${assignmentId}`),
        apiFetch(`/api/assignments/${assignmentId}/state`),
      ]);

      if (!assignmentResponse.ok || !stateResponse.ok) {
        throw new Error('Failed to load assignment workspace.');
      }

      const assignmentBody = (await assignmentResponse.json()) as { assignment: AssignmentDetailDTO };
      const stateBody = (await stateResponse.json()) as { state: AssignmentStateDTO };
      const availableUnits = assignmentBody.assignment.units;

      setAssignment(assignmentBody.assignment);
      setAssignmentState(stateBody.state);
      setViewUnitId((prev) => {
        if (prev && availableUnits.some((unit) => unit.id === prev)) {
          return prev;
        }
        return stateBody.state.currentUnitId ?? availableUnits[0]?.id ?? null;
      });
    },
    [apiFetch],
  );

  const refreshCurrentAssignment = useCallback(async () => {
    if (!currentAssignmentId) {
      return;
    }

    await loadAssignmentBundle(currentAssignmentId);
    await loadFeed();
  }, [currentAssignmentId, loadAssignmentBundle, loadFeed]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const meResponse = await apiFetch('/api/me');
      if (!meResponse.ok) {
        throw new Error('Unauthorized');
      }

      await meResponse.json();

      await loadFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize app.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, loadFeed]);

  useEffect(() => {
    loadInitial().catch(() => undefined);
  }, [loadInitial]);

  useEffect(() => {
    if (!currentAssignmentId) {
      setAssignment(null);
      setAssignmentState(null);
      return;
    }

    loadAssignmentBundle(currentAssignmentId).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load assignment.');
    });
  }, [currentAssignmentId, loadAssignmentBundle]);

  useEffect(() => {
    if (feed.length === 0 || !requestedAssignmentId) {
      return;
    }
    if (appliedRequestedSelectionRef.current === requestedSelectionKey) {
      return;
    }

    appliedRequestedSelectionRef.current = requestedSelectionKey;
    const hasRequestedAssignment = feed.some((assignment) => assignment.id === requestedAssignmentId);
    if (!hasRequestedAssignment) {
      return;
    }

    setCurrentAssignmentId(requestedAssignmentId);
    setViewUnitId(requestedUnitId ?? null);
  }, [feed, requestedAssignmentId, requestedSelectionKey, requestedUnitId]);

  const assignmentIndex = useMemo(
    () => feed.findIndex((item) => item.id === currentAssignmentId),
    [feed, currentAssignmentId],
  );

  const units = useMemo(() => assignment?.units ?? [], [assignment]);
  const readingUnits = useMemo(
    () => units.filter((unit) => unit.unitType === 'reading'),
    [units],
  );
  const stateByUnit = useMemo(() => {
    const entries = assignmentState?.unitStates ?? [];
    return new Map(entries.map((entry) => [entry.unitId, entry]));
  }, [assignmentState]);

  const activeUnitId = assignmentState?.currentUnitId ?? units[0]?.id ?? null;
  const effectiveViewUnitId = viewUnitId ?? activeUnitId;
  const viewUnitIndex = effectiveViewUnitId
    ? units.findIndex((unit) => unit.id === effectiveViewUnitId)
    : -1;
  const currentUnit = viewUnitIndex >= 0 ? units[viewUnitIndex] : null;
  const currentUnitState = currentUnit ? stateByUnit.get(currentUnit.id) : undefined;
  const selectedReadingUnit =
    readingUnits.find((unit) => unit.id === readingChatUnitId) ?? readingUnits[0] ?? null;
  const isReadingView = currentUnit?.unitType === 'reading';
  const essayDisplayTitle = assignment?.title.replace(/^Essay:\s*/i, '') ?? '';
  const readingOrdinal = viewUnitIndex >= 0 ? viewUnitIndex + 1 : 0;
  const readingTotal = units.length;

  async function persistCurrentUnitBeforeNavigation(): Promise<boolean> {
    if (!workspaceRef.current) {
      return true;
    }

    const persisted = await workspaceRef.current.persist();
    if (!persisted) {
      setError('Could not save your current unit. Please try again.');
      return false;
    }

    return true;
  }

  async function moveAssignment(delta: number) {
    if (navigationInFlightRef.current) {
      return;
    }

    if (assignmentIndex < 0) {
      return;
    }

    const nextIndex = assignmentIndex + delta;
    if (nextIndex < 0 || nextIndex >= feed.length) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setCurrentAssignmentId(feed[nextIndex].id);
      setViewUnitId(null);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  async function moveUnit(delta: number) {
    if (navigationInFlightRef.current) {
      return;
    }

    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }

    const targetIndex = viewUnitIndex + delta;
    if (targetIndex < 0 || targetIndex >= units.length) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setViewUnitId(units[targetIndex].id);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  async function jumpToCompletedUnit(targetIndex: number) {
    if (navigationInFlightRef.current) {
      return;
    }
    if (!currentUnit || viewUnitIndex < 0) {
      return;
    }
    if (targetIndex < 0 || targetIndex >= units.length) {
      return;
    }
    if (targetIndex >= viewUnitIndex) {
      return;
    }

    navigationInFlightRef.current = true;
    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      setError(null);
      setViewUnitId(units[targetIndex].id);
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  moveAssignmentRef.current = moveAssignment;
  moveUnitRef.current = moveUnit;

  async function completeCurrentUnitAndRefresh(): Promise<boolean> {
    if (!currentUnit) {
      return false;
    }

    const response = await apiFetch(`/api/units/${currentUnit.id}/complete`, {
      method: 'POST',
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Failed to complete unit.');
      return false;
    }

    const body = (await response.json()) as { result: CompleteUnitResponse };
    setError(null);
    setViewUnitId(body.result.nextUnitId ?? null);
    await refreshCurrentAssignment();
    return true;
  }

  async function patchUnitState(unitId: string, payload: PatchUnitStateRequest): Promise<void> {
    const response = await apiFetch(`/api/units/${unitId}/state`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Failed to save state.');
    }

    const body = (await response.json()) as { state: UserUnitStateDTO };
    setAssignmentState((prev) => {
      if (!prev) {
        return prev;
      }

      const nextStates = prev.unitStates.filter((entry) => entry.unitId !== body.state.unitId);
      nextStates.push(body.state);
      nextStates.sort((a, b) => {
        const aIndex = units.findIndex((unit) => unit.id === a.unitId);
        const bIndex = units.findIndex((unit) => unit.id === b.unitId);
        return aIndex - bIndex;
      });

      return {
        ...prev,
        unitStates: nextStates,
      };
    });
  }

  async function toggleBookmark() {
    if (!currentUnit || !currentUnitState) {
      return;
    }

    const payload: BookmarkUnitRequest = { bookmarked: !currentUnitState.bookmarked };
    const response = await apiFetch(`/api/units/${currentUnit.id}/bookmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as { state: UserUnitStateDTO };
    setAssignmentState((prev) => {
      if (!prev) {
        return prev;
      }

      const unitStates = prev.unitStates.map((entry) =>
        entry.unitId === body.state.unitId ? body.state : entry,
      );

      return {
        ...prev,
        unitStates,
      };
    });
  }

  async function runRevisionChecks(): Promise<RevisionIssue[]> {
    if (!currentAssignmentId) {
      return [];
    }

    const response = await apiFetch(`/api/assignments/${currentAssignmentId}/revision-checks`);
    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as { issues: RevisionIssue[] };
    return body.issues;
  }

  const requestClarificationChat = useCallback(
    async (unitId: string, message: string): Promise<ClarificationTurn> => {
      const response = await apiFetch(`/api/units/${unitId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to send clarification request.');
      }

      const body = (await response.json()) as { turn: ClarificationTurn };
      return body.turn;
    },
    [apiFetch],
  );

  const requestClarificationHistory = useCallback(
    async (unitId: string): Promise<ClarificationTurn[]> => {
      const response = await apiFetch(`/api/units/${unitId}/chat`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load chat history.');
      }

      const body = (await response.json()) as { turns?: ClarificationTurn[] };
      return Array.isArray(body.turns) ? body.turns : [];
    },
    [apiFetch],
  );

  const requestThesisSuggestions = useCallback(
    async (unitId: string, regenerate: boolean): Promise<ThesisSuggestion[]> => {
      const response = await apiFetch(`/api/units/${unitId}/thesis-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ regenerate }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to generate thesis suggestions.');
      }

      const body = (await response.json()) as { suggestions?: ThesisSuggestion[] };
      return Array.isArray(body.suggestions) ? body.suggestions : [];
    },
    [apiFetch],
  );

  const requestOutlineGenerate = useCallback(
    async (unitId: string): Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>> => {
      const response = await apiFetch(`/api/units/${unitId}/outline-generate`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to generate outline.');
      }

      const body = (await response.json()) as {
        sections?: Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>;
      };
      return Array.isArray(body.sections) ? body.sections : [];
    },
    [apiFetch],
  );

  const requestWritingHint = useCallback(
    async (unitId: string, currentSectionText: string): Promise<string> => {
      const response = await apiFetch(`/api/units/${unitId}/writing-hint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentSectionText }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to generate writing hint.');
      }

      const body = (await response.json()) as { hint?: { text?: string } };
      return typeof body.hint?.text === 'string' ? body.hint.text : '';
    },
    [apiFetch],
  );

  async function sendReadingClarificationMessage() {
    const message = readingChatMessage.trim();
    if (!message || !readingChatUnitId || readingChatBusy || readingChatLoading) {
      return;
    }

    setReadingChatBusy(true);
    setReadingChatError(null);
    try {
      const turn = await requestClarificationChat(readingChatUnitId, message);
      setReadingChatTurns((previous) => [...previous, turn]);
      setReadingChatMessage('');
    } catch (chatError) {
      setReadingChatError(chatError instanceof Error ? chatError.message : 'Failed to send clarification request.');
    } finally {
      setReadingChatBusy(false);
    }
  }

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: () => {
      void moveAssignment(1);
    },
    onSwipeRight: () => {
      void moveAssignment(-1);
    },
    onSwipeUp: () => {
      void moveUnit(1);
    },
    onSwipeDown: () => {
      void moveUnit(-1);
    },
  });

  useEffect(() => {
    if (readingUnits.length === 0) {
      setReadingChatUnitId(null);
      return;
    }

    if (currentUnit?.unitType === 'reading') {
      setReadingChatUnitId(currentUnit.id);
      return;
    }

    const preferredUnitId =
      activeUnitId && readingUnits.some((unit) => unit.id === activeUnitId)
        ? activeUnitId
        : readingUnits[0]?.id ?? null;
    setReadingChatUnitId(preferredUnitId);
  }, [activeUnitId, currentUnit?.id, currentUnit?.unitType, readingUnits]);

  useEffect(() => {
    if (!isReadingChatOpen || !readingChatUnitId) {
      return;
    }

    setReadingChatLoading(true);
    setReadingChatError(null);
    requestClarificationHistory(readingChatUnitId)
      .then((turns) => {
        setReadingChatTurns(turns);
      })
      .catch((chatError: unknown) => {
        setReadingChatError(chatError instanceof Error ? chatError.message : 'Failed to load chat history.');
      })
      .finally(() => {
        setReadingChatLoading(false);
      });
  }, [isReadingChatOpen, readingChatUnitId, requestClarificationHistory]);

  useEffect(() => {
    if (!isReadingChatOpen) {
      return;
    }

    const element = readingChatScrollRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [isReadingChatOpen, readingChatTurns]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (
          tagName === 'INPUT' ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void moveAssignmentRef.current(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void moveAssignmentRef.current(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        void moveUnitRef.current(-1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        void moveUnitRef.current(1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function onFeedWheel(event: ReactWheelEvent<HTMLElement>) {
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    const threshold = 45;

    if (absY > absX && absY > threshold) {
      event.preventDefault();
      void moveUnit(event.deltaY > 0 ? 1 : -1);
      return;
    }

    if (absX > absY && absX > threshold) {
      event.preventDefault();
      void moveAssignment(event.deltaX > 0 ? 1 : -1);
    }
  }

  if (loading) {
    return (
      <main className="container" style={{ paddingTop: 30 }}>
        <div className="panel pulse" style={{ padding: 24 }}>
          Loading study feed...
        </div>
      </main>
    );
  }

  return (
    <main
      className={isReadingView ? 'reading-assistant-page' : 'essay-assistant-page'}
      style={{ paddingTop: 0, paddingBottom: isReadingView ? 0 : 6 }}
    >
      {error ? (
        <p className="error" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      <section
        className={
          isReadingView
            ? 'panel reading-assistant-shell'
            : 'essay-assistant-shell essay-container'
        }
        style={isReadingView ? { padding: 16, minHeight: 600 } : { minHeight: 0 }}
        {...swipeHandlers}
        onWheel={onFeedWheel}
      >
        {assignment && assignmentState && currentUnit ? (
          <>
            {isReadingView ? (
              <div className="reading-assistant-header">
                <p className="reading-assistant-subject">{assignment.subject}</p>
              </div>
            ) : (
              <div className="essay-assistant-header">
                <h2 className="essay-assistant-title essay-title">{essayDisplayTitle}</h2>
                <div className="essay-process-path" aria-label="Essay workflow path">
                  {units.map((unit, index) => {
                    const isCompleted = index < viewUnitIndex;
                    const isCurrent = index === viewUnitIndex;
                    const isLocked = index > viewUnitIndex;
                    const symbol = isCompleted ? '✓' : isCurrent ? '●' : '○';
                    const className = `essay-process-step${isCompleted ? ' completed' : ''}${isCurrent ? ' current' : ''}${isLocked ? ' locked' : ''}`;
                    if (isCompleted) {
                      return (
                        <button
                          key={unit.id}
                          type="button"
                          className={`${className} essay-process-step-button`}
                          onClick={() => void jumpToCompletedUnit(index)}
                          aria-label={`Go to ${getEssayStepLabel(unit)} step`}
                          title={`Go to ${getEssayStepLabel(unit)}`}
                        >
                          <span className="essay-process-symbol" aria-hidden="true">
                            {symbol}
                          </span>
                          <span className="essay-process-label">{getEssayStepLabel(unit)}</span>
                        </button>
                      );
                    }

                    return (
                      <span key={unit.id} className={className} aria-disabled={isLocked || isCurrent}>
                        <span className="essay-process-symbol" aria-hidden="true">
                          {symbol}
                        </span>
                        <span className="essay-process-label">{getEssayStepLabel(unit)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {!isReadingView ? (
              <div className="essay-assistant-progress" aria-label="Essay completion progress">
                <div className="essay-assistant-progress-track">
                  <div
                    className="essay-assistant-progress-fill progress-fill"
                    style={{
                      width: `${units.length > 0 && viewUnitIndex >= 0 ? ((viewUnitIndex + 1) / units.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="essay-assistant-progress-value">
                  {units.length > 0 && viewUnitIndex >= 0
                    ? Math.round(((viewUnitIndex + 1) / units.length) * 100)
                    : 0}
                  %
                </span>
              </div>
            ) : null}
            <div className={isReadingView ? 'reading-assistant-workspace' : 'essay-assistant-workspace'} style={{ marginTop: isReadingView ? 14 : 8 }}>
              <UnitWorkspace
                ref={workspaceRef}
                unit={currentUnit}
                unitState={currentUnitState}
                units={units}
                unitStateMap={stateByUnit}
                isActive={isReadingView ? currentUnit.id === activeUnitId : true}
                readingOrdinal={readingOrdinal}
                readingTotal={readingTotal}
                readingProgressPercent={
                  readingTotal > 0
                    ? Math.max(0, Math.min(100, Math.round((readingOrdinal / readingTotal) * 100)))
                    : 0
                }
                onOpenReadingChat={
                  currentUnit.unitType === 'reading'
                    ? () => {
                        setIsReadingChatOpen(true);
                        setReadingChatError(null);
                      }
                    : undefined
                }
                onMovePrevUnit={
                  () => void moveUnit(-1)
                }
                onMoveNextUnit={
                  () => void moveUnit(1)
                }
                canMovePrevUnit={viewUnitIndex > 0}
                canMoveNextUnit={
                  viewUnitIndex >= 0 && viewUnitIndex < units.length - 1
                }
                onPatch={patchUnitState}
                onRevisionCheck={runRevisionChecks}
                onGenerateThesisSuggestions={requestThesisSuggestions}
                onGenerateOutline={requestOutlineGenerate}
                onRequestWritingHint={requestWritingHint}
                onCompleteUnit={completeCurrentUnitAndRefresh}
              />
            </div>
            {!isReadingView ? (
              <div className="essay-assistant-nav row mobile-stack" style={{ marginTop: 8 }}>
                {readingUnits.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => {
                      setIsReadingChatOpen(true);
                      setReadingChatError(null);
                    }}
                  >
                    Open Clarification Chat
                  </button>
                ) : null}
              </div>
            ) : null}
            {isReadingView ? (
              <div className="reading-assistant-global-left">
                <button
                  type="button"
                  className="reading-assistant-menu-btn icon"
                  aria-label="Menu"
                  title="Menu"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M4 6h16M4 12h16M4 18h16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}
            {isReadingView ? (
              <div className="reading-assistant-global-controls">
                <button
                  type="button"
                  className="reading-assistant-bookmark-btn icon"
                  onClick={toggleBookmark}
                  aria-label={currentUnitState?.bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                  title={currentUnitState?.bookmarked ? 'Remove bookmark' : 'Add bookmark'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"
                      fill={currentUnitState?.bookmarked ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}

            {isReadingChatOpen && selectedReadingUnit ? (
              <div className="reading-chat-modal-overlay">
                <div className="reading-chat-modal" role="dialog" aria-modal="true" aria-label="Clarification chat">
                  <button
                    type="button"
                    className="reading-chat-modal-close"
                    onClick={() => setIsReadingChatOpen(false)}
                    aria-label="Close chat"
                  >
                    ×
                  </button>
                  <h3 className="reading-chat-modal-title chat-header">Clarification Chat</h3>
                  <p className="reading-chat-modal-subtitle chat-subtitle">Ask any question.</p>

                  <div ref={readingChatScrollRef} className="reading-chat-modal-messages chat-body">
                    {readingChatLoading ? (
                      <p className="reading-chat-modal-muted">Loading chat...</p>
                    ) : null}
                    {readingChatError ? (
                      <p className="reading-chat-modal-error">{readingChatError}</p>
                    ) : null}
                    {!readingChatLoading && readingChatTurns.length === 0 ? (
                      <div className="reading-chat-modal-empty">
                        <div className="reading-chat-modal-logo" aria-hidden="true">
                          <span className="reading-chat-modal-logo-mark" />
                          <span className="reading-chat-modal-logo-word">nephix</span>
                        </div>
                        <p className="reading-chat-modal-empty-text">
                          Start with a short question about this reading.
                        </p>
                      </div>
                    ) : (
                      readingChatTurns.map((turn) => (
                        <div key={turn.id} className="reading-chat-modal-turn">
                          <div className="reading-chat-modal-bubble chat-message user user-message">{turn.userMessage}</div>
                          <div className="reading-chat-modal-bubble chat-message assistant ai-message">{turn.assistantMessage}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    className="reading-chat-modal-compose"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendReadingClarificationMessage();
                    }}
                  >
                    <input
                      className="chat-input"
                      value={readingChatMessage}
                      onChange={(event) => setReadingChatMessage(event.target.value)}
                      placeholder="Ask about the reading (10 word answers)"
                      disabled={readingChatBusy || readingChatLoading}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="reading-chat-modal-send send-button"
                      disabled={
                        readingChatBusy ||
                        readingChatLoading ||
                        !readingChatUnitId ||
                        readingChatMessage.trim().length === 0
                      }
                    >
                      {readingChatBusy ? '...' : '↑'}
                    </button>
                  </form>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">No active assignment in the feed yet.</p>
        )}
      </section>
    </main>
  );
}

type UnitWorkspaceProps = {
  unit: AssignmentDetailDTO['units'][number];
  unitState: UserUnitStateDTO | undefined;
  units: AssignmentDetailDTO['units'];
  unitStateMap: Map<string, UserUnitStateDTO>;
  isActive: boolean;
  readingOrdinal: number;
  readingTotal: number;
  readingProgressPercent: number;
  onOpenReadingChat?: () => void;
  onMovePrevUnit?: () => void;
  onMoveNextUnit?: () => void;
  canMovePrevUnit?: boolean;
  canMoveNextUnit?: boolean;
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onRevisionCheck: () => Promise<RevisionIssue[]>;
  onGenerateThesisSuggestions: (unitId: string, regenerate: boolean) => Promise<ThesisSuggestion[]>;
  onGenerateOutline: (
    unitId: string,
  ) => Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>>;
  onRequestWritingHint: (unitId: string, currentSectionText: string) => Promise<string>;
  onCompleteUnit?: () => Promise<boolean>;
};

const UnitWorkspace = forwardRef<UnitWorkspaceHandle, UnitWorkspaceProps>(function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isActive,
  readingOrdinal,
  readingTotal,
  readingProgressPercent,
  onOpenReadingChat,
  onMovePrevUnit,
  onMoveNextUnit,
  canMovePrevUnit = false,
  canMoveNextUnit = false,
  onPatch,
  onRevisionCheck,
  onGenerateThesisSuggestions,
  onGenerateOutline,
  onRequestWritingHint,
  onCompleteUnit,
}, ref) {
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const readingContainerRef = useRef<HTMLDivElement | null>(null);
  const [thesisSuggestions, setThesisSuggestions] = useState<ThesisSuggestion[]>([]);
  const [thesisSuggestionsBusy, setThesisSuggestionsBusy] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [writingHintBusy, setWritingHintBusy] = useState(false);

  useEffect(() => {
    const existing = unitState?.content;
    if (isObjectRecord(existing)) {
      setContent(existing);
    } else {
      if (unit.unitType === 'outline') {
        const sections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
        setContent({ sections, confirmed: false });
      } else if (unit.unitType === 'thesis') {
        setContent({ thesis: '', confirmed: false });
      } else if (unit.unitType === 'writing') {
        setContent({ text: '', confirmed: false });
      } else if (unit.unitType === 'revise') {
        setContent({ confirmed: false, issues: [] });
      } else {
        setContent({});
      }
    }

    setSaveState('idle');
  }, [unit.id, unit.unitType, unit.payload, unitState?.updatedAtISO, unitState?.content]);

  useEffect(() => {
    if (unit.unitType !== 'thesis') {
      setThesisSuggestions([]);
      return;
    }

    const rawSuggestions = Array.isArray(content.thesisSuggestions) ? content.thesisSuggestions : [];
    const suggestions: ThesisSuggestion[] = rawSuggestions
      .map((entry, index) => {
        if (!isObjectRecord(entry)) {
          return null;
        }

        const text = typeof entry.text === 'string' ? entry.text : '';
        if (!text) {
          return null;
        }

        return {
          id: typeof entry.id === 'string' && entry.id ? entry.id : `suggestion-${index + 1}`,
          text,
        };
      })
      .filter((entry): entry is ThesisSuggestion => Boolean(entry));
    setThesisSuggestions(suggestions.slice(0, 3));
  }, [content, unit.unitType]);

  useEffect(() => {
    if (unit.unitType !== 'reading') {
      return;
    }

    const position = unitState?.position;
    const scrollTop =
      isObjectRecord(position) && typeof position.scrollTop === 'number' ? position.scrollTop : 0;
    if (readingContainerRef.current) {
      readingContainerRef.current.scrollTop = scrollTop;
    }
  }, [unit.unitType, unit.id, unitState?.position]);

  const writingSections = useMemo(() => {
    return units
      .filter((entry) => entry.unitType === 'writing')
      .map((entry) => {
        const sectionState = unitStateMap.get(entry.id);
        const saved = sectionState?.content;
        const text = isObjectRecord(saved) && typeof saved.text === 'string' ? saved.text : '';
        return {
          title: entry.title,
          text,
          targetWords: typeof entry.targetWords === 'number' ? entry.targetWords : 0,
        };
      });
  }, [units, unitStateMap]);

  function updateContent(patch: Record<string, unknown>) {
    setSaveState('dirty');
    setContent((prev) => ({ ...prev, ...patch }));
  }

  const persist = useCallback(async () => {
    if (!isActive) {
      return true;
    }

    setSaveState('saving');

    try {
      if (unit.unitType === 'reading') {
        const scrollTop = readingContainerRef.current?.scrollTop ?? 0;
        await onPatch(unit.id, { position: { scrollTop } });
      } else {
        await onPatch(unit.id, { content });
      }
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }, [content, isActive, onPatch, unit.id, unit.unitType]);

  useImperativeHandle(
    ref,
    () => ({
      persist,
    }),
    [persist],
  );

  const essayStepFooterNav =
    unit.unitType !== 'reading' ? (
      <div className="essay-card-nav row mobile-stack">
        <button
          type="button"
          className="btn button-secondary"
          onClick={onMovePrevUnit}
          disabled={!canMovePrevUnit}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn button-primary"
          onClick={() => {
            if (unit.unitType === 'revise') {
              void (async () => {
                const saved = await persist();
                if (!saved) {
                  return;
                }
                await onCompleteUnit?.();
              })();
              return;
            }
            onMoveNextUnit?.();
          }}
          disabled={unit.unitType === 'revise' ? false : !canMoveNextUnit}
        >
          {unit.unitType === 'revise' ? 'Finish' : 'Next'}
        </button>
      </div>
    ) : null;

  if (unit.unitType === 'reading') {
    const text = typeof unit.payload.text === 'string' ? unit.payload.text : '';

    const onReadingScroll = (event: ReactUIEvent<HTMLDivElement>) => {
      if (!isActive) {
        return;
      }
      if (event.currentTarget.scrollTop >= 0) {
        setSaveState('dirty');
      }
    };

    return (
      <section className="reading-assistant-window">
        <div
          ref={readingContainerRef}
          onScroll={onReadingScroll}
          className="reading-assistant-fragment-body"
        >
          <div className="card-wrapper">
            <div className="reading-assistant-text-plate card">{text}</div>
          </div>
        </div>
        <div className="reading-assistant-inline-progress" aria-label="Reading progress">
          <div className="reading-assistant-inline-progress-track">
            <div
              className="reading-assistant-inline-progress-fill progress-fill"
              style={{ width: `${readingProgressPercent}%` }}
            />
          </div>
          <span className="reading-assistant-inline-progress-value">{readingProgressPercent}%</span>
        </div>
        <div className="reading-assistant-step-nav reading-assistant-step-nav-below">
          <button
            type="button"
            className="reading-assistant-pill-btn button-secondary"
            onClick={onMovePrevUnit}
            disabled={!canMovePrevUnit}
          >
            Previous
          </button>
          <button
            type="button"
            className="reading-assistant-pill-btn button-primary"
            onClick={onMoveNextUnit}
            disabled={!canMoveNextUnit}
          >
            Next
          </button>
        </div>
        <div className="reading-assistant-chat-wrap">
          <button
            type="button"
            className="reading-assistant-chat-trigger"
            onClick={onOpenReadingChat}
            aria-label="Open clarification chat"
            title="Open clarification chat"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 6.5A3.5 3.5 0 0 1 7.5 3h9A3.5 3.5 0 0 1 20 6.5v5A3.5 3.5 0 0 1 16.5 15H11l-4.8 3.8a.7.7 0 0 1-1.2-.5V15A3.5 3.5 0 0 1 1 11.5v-5A3.5 3.5 0 0 1 4.5 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8.5" cy="9" r="1" fill="currentColor" />
              <circle cx="12" cy="9" r="1" fill="currentColor" />
              <circle cx="15.5" cy="9" r="1" fill="currentColor" />
            </svg>
          </button>
          <span className="reading-assistant-unit-counter" aria-label={`Reading ${readingOrdinal} of ${readingTotal}`}>
            <span className="reading-assistant-unit-counter-short">{readingOrdinal}</span>
            <span className="reading-assistant-unit-counter-full">{readingOrdinal} of {readingTotal}</span>
          </span>
        </div>
      </section>
    );
  }

  if (unit.unitType === 'thesis') {
    const thesis = typeof content.thesis === 'string' ? content.thesis : '';
    const thesisCharLimit = 200;
    const hasSuggestions = thesisSuggestions.length > 0;

    return (
      <EssayCardShell title={unit.title} noHeaderDivider footer={essayStepFooterNav}>
        <p className="essay-thesis-suggestions-label">Suggested thesis ideas</p>
        {hasSuggestions ? (
          <div className="essay-thesis-suggestions">
            {thesisSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.id}
                type="button"
                className={`btn btn-soft suggestion-card${suggestion.text === thesis ? ' selected' : ''}`}
                style={{ textAlign: 'left' }}
                disabled={!isActive}
                onClick={() => {
                  updateContent({
                    thesis: suggestion.text,
                  });
                }}
              >
                <span className="suggestion-theme-tag">{getSuggestionThemeTag(suggestion.text, index)}</span>
                <span>{suggestion.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="row mobile-stack essay-thesis-generate-row">
          <button
            type="button"
            className="btn btn-sm button-secondary thesis-generate-btn"
            disabled={!isActive || thesisSuggestionsBusy}
            onClick={async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, hasSuggestions);
                const limited = suggestions.slice(0, 3);
                setThesisSuggestions(limited);
                updateContent({ thesisSuggestions: limited });
              } catch {
                setSaveState('error');
              } finally {
                setThesisSuggestionsBusy(false);
              }
            }}
          >
            <span className="thesis-generate-icon" aria-hidden="true">↻</span>{' '}
            {thesisSuggestionsBusy
              ? 'Generating...'
              : hasSuggestions
                ? 'Generate new ideas'
                : 'Generate ideas'}
          </button>
        </div>
        <div className="essay-thesis-or-divider" aria-hidden="true">
          <span>— or write your own thesis —</span>
        </div>
        <textarea
          className="essay-thesis-input"
          value={thesis}
          onChange={(event) => updateContent({ thesis: event.target.value })}
          placeholder="Write your thesis in 1-2 sentences..."
          disabled={!isActive}
        />
        <p className="muted" style={{ margin: 0 }}>
          {thesis.length} / {thesisCharLimit} characters
        </p>
      </EssayCardShell>
    );
  }

  if (unit.unitType === 'outline') {
    const fallbackSections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
    const sections = Array.isArray(content.sections) ? content.sections : fallbackSections;
    const hasGeneratedOutline = Boolean(content.outlineGenerated);

    return (
      <EssayCardShell
        title={unit.title}
        subtitle="Adjust section plan while staying close to target word balance."
        footer={essayStepFooterNav}
      >
        <p className="outline-plan-top-label">Outline sections</p>
        <div className="row mobile-stack outline-generate-row">
          <button
            type="button"
            className="btn btn-sm button-secondary thesis-generate-btn"
            disabled={!isActive || outlineBusy}
            onClick={async () => {
              setOutlineBusy(true);
              try {
                const generated = await onGenerateOutline(unit.id);
                updateContent({ sections: generated, outlineGenerated: true });
              } catch {
                setSaveState('error');
              } finally {
                setOutlineBusy(false);
              }
            }}
          >
            <span className="thesis-generate-icon" aria-hidden="true">↻</span>{' '}
            {outlineBusy ? 'Generating...' : hasGeneratedOutline ? 'Regenerate outline' : 'Generate outline'}
          </button>
        </div>
        <div className="outline-plan-list">
          {sections.map((rawSection, index) => {
            const section = isObjectRecord(rawSection) ? rawSection : {};
            const id = typeof section.id === 'string' ? section.id : `section-${index + 1}`;
            const title = typeof section.title === 'string' ? section.title : '';
            const guidingQuestion =
              typeof section.guidingQuestion === 'string' ? section.guidingQuestion : '';
            const targetWords =
              typeof section.targetWords === 'number' ? section.targetWords : Number(section.targetWords) || 0;

            return (
              <article key={id} className="outline-plan-card">
                <p className="outline-plan-section-label">
                  {index + 1}. {getOutlineSectionLabel(title, index)}
                </p>
                <input
                  className="outline-plan-prompt-input"
                  value={guidingQuestion}
                  onChange={(event) => {
                    const next = [...sections];
                    next[index] = {
                      ...(isObjectRecord(next[index]) ? next[index] : {}),
                      id,
                      title,
                      guidingQuestion: event.target.value,
                      targetWords,
                    };
                    updateContent({ sections: next });
                  }}
                  placeholder="Write a guiding question for this section..."
                  disabled={!isActive}
                />
                <p className="outline-plan-length">{getOutlineLengthHint(targetWords)}</p>
              </article>
            );
          })}
        </div>
      </EssayCardShell>
    );
  }

  if (unit.unitType === 'writing') {
    const text = typeof content.text === 'string' ? content.text : '';
    const targetWords = typeof unit.targetWords === 'number' ? unit.targetWords : null;
    const hint = typeof content.writingHint === 'string' ? content.writingHint : '';
    const guidingQuestion =
      typeof unit.payload.guidingQuestion === 'string' ? unit.payload.guidingQuestion : '';

    return (
      <EssayCardShell
        title={unit.title}
        subtitle="Draft this section only. Focus on ideas and flow first."
        footer={essayStepFooterNav}
      >
        <p className="writing-unit-top-label">{getWritingUnitLabel(unit.title)}</p>
        {guidingQuestion ? (
          <p className="writing-unit-goal">Goal: {guidingQuestion}</p>
        ) : null}
        <div className="row mobile-stack writing-hint-row">
          <button
            type="button"
            className="btn btn-sm button-secondary thesis-generate-btn"
            disabled={!isActive || writingHintBusy}
            onClick={async () => {
              setWritingHintBusy(true);
              try {
                const nextHint = await onRequestWritingHint(unit.id, text);
                if (nextHint) {
                  updateContent({ writingHint: nextHint });
                }
              } catch {
                setSaveState('error');
              } finally {
                setWritingHintBusy(false);
              }
            }}
          >
            <span className="writing-hint-icon" aria-hidden="true">+</span>{' '}
            {writingHintBusy ? 'Generating...' : 'Suggest a hint'}
          </button>
        </div>
        {hint ? (
          <div className="writing-hint-panel">
            <p className="writing-hint-label">Hint</p>
            <p className="writing-hint-text">{hint}</p>
          </div>
        ) : null}
        <textarea
          className="writing-unit-textarea"
          value={text}
          onChange={(event) => updateContent({ text: event.target.value })}
          disabled={!isActive}
          placeholder="Start drafting this section..."
        />
        <p className="writing-unit-counter">
          {countWords(text)} / {typeof targetWords === 'number' ? targetWords : 150} words
        </p>
      </EssayCardShell>
    );
  }

  const fullDraft = writingSections
    .map((section) => section.text.trim())
    .filter(Boolean)
    .join('\n\n');
  const revisionDraft = typeof content.revisionDraft === 'string' ? content.revisionDraft : fullDraft;
  return (
    <EssayCardShell
      title={unit.title}
      subtitle="Improve clarity and structure."
      footer={essayStepFooterNav}
    >
      <p className="writing-unit-top-label">REVISION</p>

      <label className="field revise-draft-field">
        <span>Your essay draft</span>
        <textarea
          value={revisionDraft}
          onChange={(event) => updateContent({ revisionDraft: event.target.value })}
          disabled={!isActive}
          className="revise-draft-textarea"
        />
      </label>

      <div className="row revise-analyze-row">
        <button
          type="button"
          className="btn button-secondary thesis-generate-btn"
          onClick={async () => {
            const nextIssues = await onRevisionCheck();
            updateContent({ issues: nextIssues });
          }}
          disabled={!isActive}
        >
          Analyze draft
        </button>
      </div>

    </EssayCardShell>
  );
});
