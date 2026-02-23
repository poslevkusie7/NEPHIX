'use client';

import { useRouter } from 'next/navigation';
import {
  FormEvent,
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
import { CardShell, UnitStatusBadge } from '@nephix/ui';

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

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [feed, setFeed] = useState<AssignmentSummaryDTO[]>([]);
  const [currentAssignmentId, setCurrentAssignmentId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetailDTO | null>(null);
  const [assignmentState, setAssignmentState] = useState<AssignmentStateDTO | null>(null);
  const [viewUnitId, setViewUnitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
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

      const meBody = (await meResponse.json()) as { user: { email: string } };
      setUserEmail(meBody.user.email);

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
  const activeUnitIndex = activeUnitId ? units.findIndex((unit) => unit.id === activeUnitId) : -1;
  const effectiveViewUnitId = viewUnitId ?? activeUnitId;
  const viewUnitIndex = effectiveViewUnitId
    ? units.findIndex((unit) => unit.id === effectiveViewUnitId)
    : -1;
  const currentUnit = viewUnitIndex >= 0 ? units[viewUnitIndex] : null;
  const currentUnitState = currentUnit ? stateByUnit.get(currentUnit.id) : undefined;
  const selectedReadingUnit =
    readingUnits.find((unit) => unit.id === readingChatUnitId) ?? readingUnits[0] ?? null;

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

  async function completeUnit() {
    if (navigationInFlightRef.current) {
      return;
    }

    if (!currentUnit) {
      return;
    }

    if (currentUnit.id !== activeUnitId) {
      setError('Only the active unit can be completed.');
      return;
    }

    navigationInFlightRef.current = true;

    try {
      const canContinue = await persistCurrentUnitBeforeNavigation();
      if (!canContinue) {
        return;
      }

      const completed = await completeCurrentUnitAndRefresh();
      if (!completed) {
        return;
      }
    } finally {
      navigationInFlightRef.current = false;
    }
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

  async function logout(event: FormEvent) {
    event.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  async function deleteAccount() {
    if (deletingAccount) {
      return;
    }

    const confirmed = window.confirm(
      'Delete your account permanently? This will remove all your study progress and cannot be undone.',
    );
    if (!confirmed) {
      return;
    }

    setDeletingAccount(true);
    setError(null);

    try {
      const response = await apiFetch('/api/me', { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Failed to delete account.');
        return;
      }
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account.');
    } finally {
      setDeletingAccount(false);
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
    <main className="container" style={{ paddingTop: 20, paddingBottom: 26 }}>
      <header className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Nephix Study Feed</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {userEmail ? `Signed in as ${userEmail}` : 'Signed in'}
            </p>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteAccount()}
              disabled={deletingAccount}
            >
              {deletingAccount ? 'Deleting...' : 'Delete Account'}
            </button>
            <form onSubmit={logout}>
              <button type="submit" className="btn">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      {error ? (
        <p className="error" style={{ marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      <section
        className="panel"
        style={{ padding: 16, minHeight: 600 }}
        {...swipeHandlers}
        onWheel={onFeedWheel}
      >
        {assignment && assignmentState && currentUnit ? (
          <>
            <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  Assignment {assignmentIndex + 1}/{feed.length} • Swipe left/right or use ← →
                </p>
                <h2 style={{ margin: '4px 0 0' }}>{assignment.title}</h2>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {assignment.subject} • Due {new Date(assignment.deadlineISO).toLocaleDateString()}
                </p>
              </div>
              <UnitStatusBadge status={currentUnitState?.status ?? 'unread'} />
            </div>

            <div
              style={{
                marginTop: 10,
                height: 8,
                borderRadius: 999,
                background: '#e2e8f0',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${units.length > 0 ? ((activeUnitIndex + 1) / units.length) * 100 : 0}%`,
                  background: '#0f766e',
                  height: '100%',
                }}
              />
            </div>

            <div className="row mobile-stack" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => void moveUnit(-1)} disabled={viewUnitIndex <= 0}>
                Previous Unit
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void moveUnit(1)}
                disabled={viewUnitIndex < 0 || viewUnitIndex >= units.length - 1}
              >
                Next Unit
              </button>
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
              {currentUnit.unitType === 'reading' ? (
                <button type="button" className="btn btn-soft" onClick={toggleBookmark}>
                  {currentUnitState?.bookmarked ? 'Remove Bookmark' : 'Bookmark'}
                </button>
              ) : null}
              {currentUnit.unitType === 'reading' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={completeUnit}
                  disabled={currentUnit.id !== activeUnitId}
                >
                  Mark Complete
                </button>
              ) : null}
            </div>
            {currentUnit.unitType === 'reading' ? (
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Bookmark saves this reading fragment for later review. It does not change completion progress.
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Essay flow: check &quot;I confirm...&quot; to save this step, then scroll down to continue.
              </p>
            )}

            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Unit {viewUnitIndex + 1}/{units.length} • Swipe/scroll up-down or use ↑ ↓
            </p>

            <div style={{ marginTop: 14 }}>
              <UnitWorkspace
                ref={workspaceRef}
                unit={currentUnit}
                unitState={currentUnitState}
                units={units}
                unitStateMap={stateByUnit}
                isActive={currentUnit.id === activeUnitId}
                onPatch={patchUnitState}
                onRevisionCheck={runRevisionChecks}
                onGenerateThesisSuggestions={requestThesisSuggestions}
                onGenerateOutline={requestOutlineGenerate}
                onRequestWritingHint={requestWritingHint}
              />
            </div>

            {isReadingChatOpen && selectedReadingUnit ? (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(15, 23, 42, 0.45)',
                  zIndex: 70,
                  display: 'grid',
                  placeItems: 'center',
                  padding: 16,
                }}
              >
                <div
                  className="panel"
                  style={{
                    width: 'min(760px, 100%)',
                    maxHeight: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 14,
                    overflow: 'hidden',
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Clarification chat"
                >
                  <div className="row mobile-stack" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>Clarification Chat</strong>
                    <button type="button" className="btn btn-sm" onClick={() => setIsReadingChatOpen(false)}>
                      Close
                    </button>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    Ask any question. Chat answers are capped at 10 words.
                  </p>

                  <div
                    ref={readingChatScrollRef}
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      maxHeight: '48vh',
                      overflowY: 'auto',
                      padding: '6px 2px',
                    }}
                  >
                    {readingChatLoading ? (
                      <p className="muted" style={{ margin: 0 }}>
                        Loading chat...
                      </p>
                    ) : null}
                    {readingChatError ? (
                      <p className="error" style={{ margin: 0 }}>
                        {readingChatError}
                      </p>
                    ) : null}
                    {!readingChatLoading && readingChatTurns.length === 0 ? (
                      <p className="muted" style={{ margin: 0 }}>
                        Example input: What is the main idea here?
                      </p>
                    ) : (
                      readingChatTurns.map((turn) => (
                        <div key={turn.id} style={{ display: 'grid', gap: 8 }}>
                          <div
                            style={{
                              alignSelf: 'flex-end',
                              maxWidth: '86%',
                              border: '1px solid #99f6e4',
                              borderRadius: 12,
                              background: '#ccfbf1',
                              padding: '8px 10px',
                            }}
                          >
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{turn.userMessage}</p>
                          </div>
                          <div
                            style={{
                              alignSelf: 'flex-start',
                              maxWidth: '86%',
                              border: '1px solid #dbe3ec',
                              borderRadius: 12,
                              background: '#f8fafc',
                              padding: '8px 10px',
                            }}
                          >
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{turn.assistantMessage}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    className="row mobile-stack"
                    style={{
                      marginTop: 10,
                      alignItems: 'flex-end',
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendReadingClarificationMessage();
                    }}
                  >
                    <input
                      value={readingChatMessage}
                      onChange={(event) => setReadingChatMessage(event.target.value)}
                      placeholder="Type your question..."
                      disabled={readingChatBusy || readingChatLoading}
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button
                      type="submit"
                      className="btn btn-sm btn-primary"
                      disabled={
                        readingChatBusy ||
                        readingChatLoading ||
                        !readingChatUnitId ||
                        readingChatMessage.trim().length === 0
                      }
                    >
                      {readingChatBusy ? 'Sending...' : 'Send'}
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
  onPatch: (unitId: string, payload: PatchUnitStateRequest) => Promise<void>;
  onRevisionCheck: () => Promise<RevisionIssue[]>;
  onGenerateThesisSuggestions: (unitId: string, regenerate: boolean) => Promise<ThesisSuggestion[]>;
  onGenerateOutline: (
    unitId: string,
  ) => Promise<Array<{ id: string; title: string; guidingQuestion: string; targetWords: number }>>;
  onRequestWritingHint: (unitId: string, currentSectionText: string) => Promise<string>;
};

const UnitWorkspace = forwardRef<UnitWorkspaceHandle, UnitWorkspaceProps>(function UnitWorkspace({
  unit,
  unitState,
  units,
  unitStateMap,
  isActive,
  onPatch,
  onRevisionCheck,
  onGenerateThesisSuggestions,
  onGenerateOutline,
  onRequestWritingHint,
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
    setThesisSuggestions(suggestions);
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

  async function setConfirmedAndPersist(confirmed: boolean) {
    const nextContent = { ...content, confirmed };
    setContent(nextContent);

    if (!isActive) {
      return;
    }

    setSaveState('saving');
    try {
      await onPatch(unit.id, { content: nextContent });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
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

  const saveLabel =
    saveState === 'saving'
      ? 'Saving...'
      : saveState === 'saved'
        ? 'Saved on navigation'
        : saveState === 'dirty'
          ? 'Unsaved changes. Move to next/prev to save.'
        : saveState === 'error'
          ? 'Save failed'
          : '';

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
      <CardShell title={unit.title} subtitle="Read this fragment and move to the next unit when done.">
        <div
          ref={readingContainerRef}
          onScroll={onReadingScroll}
          style={{
            border: '1px solid #dbe3ec',
            borderRadius: 12,
            padding: 14,
            background: '#f8fafc',
            maxHeight: 320,
            overflow: 'auto',
            lineHeight: 1.6,
          }}
        >
          {text}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Use &quot;Open Clarification Chat&quot; for AI help without changing source text.
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'thesis') {
    const thesis = typeof content.thesis === 'string' ? content.thesis : '';
    const confirmed = Boolean(content.confirmed);

    return (
      <CardShell title={unit.title} subtitle="Formulate one clear thesis and confirm it.">
        <label className="field">
          <span>Thesis statement</span>
          <textarea
            value={thesis}
            onChange={(event) => updateContent({ thesis: event.target.value })}
            placeholder="Write your thesis in 1-2 sentences..."
            disabled={!isActive}
          />
        </label>
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!isActive || thesisSuggestionsBusy}
            onClick={async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, false);
                setThesisSuggestions(suggestions);
                updateContent({ thesisSuggestions: suggestions });
              } catch {
                setSaveState('error');
              } finally {
                setThesisSuggestionsBusy(false);
              }
            }}
          >
            {thesisSuggestionsBusy ? 'Generating...' : 'Generate thesis ideas'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!isActive || thesisSuggestionsBusy}
            onClick={async () => {
              setThesisSuggestionsBusy(true);
              try {
                const suggestions = await onGenerateThesisSuggestions(unit.id, true);
                setThesisSuggestions(suggestions);
                updateContent({ thesisSuggestions: suggestions });
              } catch {
                setSaveState('error');
              } finally {
                setThesisSuggestionsBusy(false);
              }
            }}
          >
            Regenerate
          </button>
        </div>
        {thesisSuggestions.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {thesisSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="btn btn-soft"
                style={{
                  textAlign: 'left',
                  borderColor: suggestion.text === thesis ? '#0d9488' : undefined,
                }}
                disabled={!isActive}
                onClick={() => {
                  updateContent({
                    thesis: suggestion.text,
                  });
                }}
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        ) : null}
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isActive}
          />
          <span>I confirm this thesis as final for this assignment</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {thesis.length} characters. {saveLabel}
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'outline') {
    const fallbackSections = Array.isArray(unit.payload.sections) ? unit.payload.sections : [];
    const sections = Array.isArray(content.sections) ? content.sections : fallbackSections;
    const confirmed = Boolean(content.confirmed);

    return (
      <CardShell title={unit.title} subtitle="Adjust section plan while staying close to target word balance.">
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!isActive || outlineBusy}
            onClick={async () => {
              setOutlineBusy(true);
              try {
                const generated = await onGenerateOutline(unit.id);
                updateContent({ sections: generated });
              } catch {
                setSaveState('error');
              } finally {
                setOutlineBusy(false);
              }
            }}
          >
            {outlineBusy ? 'Generating...' : 'Generate outline'}
          </button>
        </div>
        <div className="outline-table-wrap">
          <table className="outline-table">
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Guiding Question</th>
                <th scope="col">Target Words</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((rawSection, index) => {
                const section = isObjectRecord(rawSection) ? rawSection : {};
                const id = typeof section.id === 'string' ? section.id : `section-${index + 1}`;
                const title = typeof section.title === 'string' ? section.title : '';
                const guidingQuestion =
                  typeof section.guidingQuestion === 'string' ? section.guidingQuestion : '';
                const targetWords =
                  typeof section.targetWords === 'number' ? section.targetWords : Number(section.targetWords) || 0;

                return (
                  <tr key={id}>
                    <td>
                      <input
                        value={title}
                        onChange={(event) => {
                          const next = [...sections];
                          next[index] = {
                            ...(isObjectRecord(next[index]) ? next[index] : {}),
                            id,
                            title: event.target.value,
                            guidingQuestion,
                            targetWords,
                          };
                          updateContent({ sections: next });
                        }}
                        disabled={!isActive}
                      />
                    </td>
                    <td>
                      <input
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
                        disabled={!isActive}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={targetWords}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const bounded = Math.max(0, Number.isFinite(value) ? value : 0);
                          const next = [...sections];
                          next[index] = {
                            ...(isObjectRecord(next[index]) ? next[index] : {}),
                            id,
                            title,
                            guidingQuestion,
                            targetWords: bounded,
                          };
                          updateContent({ sections: next });
                        }}
                        disabled={!isActive}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isActive}
          />
          <span>I confirm this outline</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {saveLabel}
        </p>
      </CardShell>
    );
  }

  if (unit.unitType === 'writing') {
    const text = typeof content.text === 'string' ? content.text : '';
    const confirmed = Boolean(content.confirmed);
    const targetWords = typeof unit.targetWords === 'number' ? unit.targetWords : null;
    const hint = typeof content.writingHint === 'string' ? content.writingHint : '';

    return (
      <CardShell title={unit.title} subtitle="Draft this section only. Focus on ideas and flow first.">
        {typeof unit.payload.guidingQuestion === 'string' ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {unit.payload.guidingQuestion}
          </p>
        ) : null}
        <div className="row mobile-stack">
          <button
            type="button"
            className="btn btn-sm"
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
            {writingHintBusy ? 'Generating...' : 'Suggest a hint'}
          </button>
        </div>
        {hint ? (
          <div
            style={{
              border: '1px solid #dbe3ec',
              borderRadius: 12,
              padding: 10,
              background: '#f8fafc',
            }}
          >
            <p className="muted" style={{ margin: 0 }}>
              Hint
            </p>
            <p style={{ margin: '4px 0 0' }}>{hint}</p>
          </div>
        ) : null}
        <label className="field">
          <span>Draft text</span>
          <textarea
            value={text}
            onChange={(event) => updateContent({ text: event.target.value })}
            disabled={!isActive}
            style={{ minHeight: 240 }}
          />
        </label>
        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              void setConfirmedAndPersist(event.target.checked);
            }}
            disabled={!isActive}
          />
          <span>I confirm this section draft is ready</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          {countWords(text)} words
          {typeof targetWords === 'number' ? ` (target ${targetWords})` : ''}. {saveLabel}
        </p>
      </CardShell>
    );
  }

  const issues = Array.isArray(content.issues)
    ? content.issues.filter((issue) => isObjectRecord(issue))
    : [];
  const confirmed = Boolean(content.confirmed);
  const fullDraft = writingSections.map((section) => `## ${section.title}\n${section.text}`).join('\n\n');

  return (
    <CardShell title={unit.title} subtitle="Run rule-based checks and confirm revision goals.">
      <label className="field">
        <span>Current draft context (read-only)</span>
        <textarea value={fullDraft} readOnly style={{ minHeight: 220, background: '#f8fafc' }} />
      </label>

      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const nextIssues = await onRevisionCheck();
            updateContent({ issues: nextIssues });
          }}
        >
          Run Revision Checks
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {issues.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No issues yet. Run checks to analyze structure and word balance.
          </p>
        ) : (
          issues.map((rawIssue, index) => {
            const severity =
              rawIssue.severity === 'high' || rawIssue.severity === 'medium' || rawIssue.severity === 'low'
                ? rawIssue.severity
                : 'low';
            const message = typeof rawIssue.message === 'string' ? rawIssue.message : 'Issue';
            const sectionTitle =
              typeof rawIssue.sectionTitle === 'string' ? rawIssue.sectionTitle : undefined;

            return (
              <div
                key={`${message}-${index}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 10,
                  background:
                    severity === 'high' ? '#fee2e2' : severity === 'medium' ? '#fef3c7' : '#eff6ff',
                }}
              >
                <strong style={{ textTransform: 'uppercase', fontSize: 12 }}>{severity}</strong>
                <p style={{ margin: '6px 0 0' }}>{message}</p>
                {sectionTitle ? (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                    Section: {sectionTitle}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <label className="row" style={{ alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            void setConfirmedAndPersist(event.target.checked);
          }}
          disabled={!isActive}
        />
        <span>I confirm revision is complete for this assignment.</span>
      </label>
      <p className="muted" style={{ margin: 0 }}>
        {saveLabel}
      </p>
    </CardShell>
  );
});
