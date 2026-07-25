'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Card,
  ColumnId,
  Project,
  ServerFrame,
  Session,
} from '@/lib/types';
import { chime } from '@/lib/chime';

type Toast = { id: number; message: string; tone: 'info' | 'good' | 'bad' };

type OutputHandler = (data: string, isReplay: boolean) => void;

type Ctx = {
  projects: Project[];
  cards: Card[];
  sessions: Session[];
  loading: boolean;
  connected: boolean;

  activeTab: string; // 'board' | sessionId
  setActiveTab: (tab: string) => void;

  muted: boolean;
  setMuted: (muted: boolean) => void;

  /** When each waiting episode began, for the stale-session prompt. */
  idleSince: Record<string, number>;
  /** Last rendered terminal screen per session, read from xterm's own buffer. */
  screens: Record<string, string>;
  publishScreen: (sessionId: string, text: string) => void;

  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;

  addProject: (input: {
    displayName: string;
    folderPath: string;
    stack?: string;
  }) => Promise<void>;
  setProjectArchived: (id: string, archived: boolean) => Promise<void>;
  removeProject: (id: string) => Promise<void>;

  addCard: (input: {
    projectId: string;
    title: string;
    description: string;
    column?: ColumnId;
  }) => Promise<void>;
  saveCard: (id: string, updates: Partial<Card>) => Promise<void>;
  moveCard: (id: string, column: ColumnId, position?: number) => Promise<void>;
  removeCard: (id: string) => Promise<void>;
  clearColumn: (column: ColumnId) => Promise<number>;

  runCard: (cardId: string) => Promise<void>;
  openProjectSession: (projectId: string) => Promise<void>;
  restartSession: (sessionId: string) => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;

  /** Terminal panes register here to receive their session's bytes. */
  subscribeOutput: (sessionId: string, handler: OutputHandler) => () => void;
  sendInput: (sessionId: string, data: string) => void;
  sendResize: (sessionId: string, cols: number, rows: number) => void;
};

const CockpitContext = createContext<Ctx | null>(null);

export function useCockpit() {
  const ctx = useContext(CockpitContext);
  if (!ctx) throw new Error('useCockpit must be used inside <CockpitProvider>');
  return ctx;
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export function CockpitProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('board');
  const [muted, setMuted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [idleSince, setIdleSince] = useState<Record<string, number>>({});
  const [screens, setScreens] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const outputHandlers = useRef(new Map<string, Set<OutputHandler>>());
  /** Frames queued while the socket is still connecting. */
  const pending = useRef<string[]>([]);
  /** Read inside socket callbacks without making them stale. */
  const activeTabRef = useRef(activeTab);
  const mutedRef = useRef(muted);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const send = useCallback((frame: object) => {
    const payload = JSON.stringify(frame);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
    else pending.current.push(payload);
  }, []);

  const publishScreen = useCallback((sessionId: string, text: string) => {
    setScreens((prev) => (prev[sessionId] === text ? prev : { ...prev, [sessionId]: text }));
  }, []);

  /* ------------------------------------------------------- initial load */

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then((r) => r.json()),
      fetch('/api/cards').then((r) => r.json()),
      fetch('/api/sessions').then((r) => r.json()),
    ])
      .then(([p, c, s]) => {
        setProjects(p);
        setCards(c);
        setSessions(s);
      })
      .catch(() => notify('Could not load the board.', 'bad'))
      .finally(() => setLoading(false));
  }, [notify]);

  /* ----------------------------------------------------- the one socket */

  useEffect(() => {
    let closedByUs = false;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        setConnected(true);
        for (const payload of pending.current) ws.send(payload);
        pending.current = [];
      });

      ws.addEventListener('message', (event) => {
        const frame: ServerFrame = JSON.parse(event.data);

        switch (frame.type) {
          case 'hello':
            setSessions(frame.sessions);
            break;

          case 'replay':
          case 'output': {
            const handlers = outputHandlers.current.get(frame.sessionId);
            if (handlers) {
              for (const handler of handlers) {
                handler(frame.data, frame.type === 'replay');
              }
            }
            break;
          }

          case 'status': {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === frame.sessionId
                  ? { ...s, status: frame.status, error: frame.error }
                  : s
              )
            );

            setIdleSince((prev) => {
              if (frame.status === 'idle' && frame.idleSince) {
                return { ...prev, [frame.sessionId]: frame.idleSince };
              }
              if (!(frame.sessionId in prev)) return prev;
              const next = { ...prev };
              delete next[frame.sessionId];
              return next;
            });

            /*
             * Chime on `attention`, not on status. The server sets it only for
             * the first idle/exit of an episode, so a TUI that repaints itself
             * can't ring the bell over and over for one finished task.
             */
            if (
              frame.attention &&
              activeTabRef.current !== frame.sessionId &&
              !mutedRef.current
            ) {
              chime(frame.status === 'exited' ? 'done' : 'attention');
            }
            break;
          }

          case 'started':
            setSessions((prev) =>
              prev.some((s) => s.id === frame.sessionId)
                ? prev
                : [...prev, frame.session]
            );
            break;

          case 'closed':
            setSessions((prev) => prev.filter((s) => s.id !== frame.sessionId));
            break;
        }
      });

      ws.addEventListener('close', () => {
        setConnected(false);
        if (!closedByUs) retry = setTimeout(connect, 1200);
      });
    }

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  /* ------------------------------------------------------------ projects */

  const addProject: Ctx['addProject'] = useCallback(
    async (input) => {
      const project = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then(jsonOrThrow);

      setProjects((prev) => [...prev, project]);
      notify(
        project.isGitRepo
          ? `Added ${project.displayName}.`
          : `Added ${project.displayName}. Heads up: no .git found, so you can't commit from here.`,
        'good'
      );
    },
    [notify]
  );

  const setProjectArchived: Ctx['setProjectArchived'] = useCallback(
    async (id, archived) => {
      const project = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      }).then(jsonOrThrow);
      setProjects((prev) => prev.map((p) => (p.id === id ? project : p)));
      notify(
        archived
          ? `${project.displayName} archived — its cards are hidden from the board.`
          : `${project.displayName} is back on the board.`,
        'good'
      );
    },
    [notify]
  );

  const removeProject: Ctx['removeProject'] = useCallback(
    async (id) => {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(jsonOrThrow);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setCards((prev) => prev.filter((c) => c.projectId !== id));
      setSessions((prev) => prev.filter((s) => s.projectId !== id));
      notify('Project removed.', 'good');
    },
    [notify]
  );

  /* --------------------------------------------------------------- cards */

  const addCard: Ctx['addCard'] = useCallback(async (input) => {
    const card = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(jsonOrThrow);
    setCards((prev) => [...prev, card]);
  }, []);

  const saveCard: Ctx['saveCard'] = useCallback(async (id, updates) => {
    const card = await fetch(`/api/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).then(jsonOrThrow);
    setCards((prev) => prev.map((c) => (c.id === id ? card : c)));
  }, []);

  /*
   * Optimistic, but it rolls back. An earlier version updated local state and
   * ignored the response, so a failed write left the board showing a move that
   * never persisted.
   */
  const moveCard: Ctx['moveCard'] = useCallback(
    async (id, column, position) => {
      let snapshot: Card[] = [];
      setCards((prev) => {
        snapshot = prev;
        return prev.map((c) =>
          c.id === id
            ? { ...c, column, ...(position !== undefined ? { position } : {}) }
            : c
        );
      });
      try {
        const card = await fetch(`/api/cards/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ column, position }),
        }).then(jsonOrThrow);
        setCards((prev) => prev.map((c) => (c.id === id ? card : c)));
      } catch (err) {
        setCards(snapshot);
        notify(err instanceof Error ? err.message : 'Could not move that card.', 'bad');
      }
    },
    [notify]
  );

  const removeCard: Ctx['removeCard'] = useCallback(
    async (id) => {
      await fetch(`/api/cards/${id}`, { method: 'DELETE' }).then(jsonOrThrow);
      setCards((prev) => prev.filter((c) => c.id !== id));
      notify('Card deleted.', 'good');
    },
    [notify]
  );

  const clearColumn: Ctx['clearColumn'] = useCallback(
    async (column) => {
      const { deleted, ids } = await fetch('/api/cards/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      }).then(jsonOrThrow);
      const removed = new Set<string>(ids);
      setCards((prev) => prev.filter((c) => !removed.has(c.id)));
      notify(`Cleared ${deleted} ${deleted === 1 ? 'card' : 'cards'}.`, 'good');
      return deleted;
    },
    [notify]
  );

  /* ------------------------------------------------------------ sessions */

  const runCard: Ctx['runCard'] = useCallback(
    async (cardId) => {
      try {
        const { session, card } = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId }),
        }).then(jsonOrThrow);

        setSessions((prev) =>
          prev.some((s) => s.id === session.id) ? prev : [...prev, session]
        );
        if (card) setCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
        setActiveTab(session.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not start a session.', 'bad');
      }
    },
    [notify]
  );

  const openProjectSession: Ctx['openProjectSession'] = useCallback(
    async (projectId) => {
      try {
        const { session } = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        }).then(jsonOrThrow);
        setSessions((prev) =>
          prev.some((s) => s.id === session.id) ? prev : [...prev, session]
        );
        setActiveTab(session.id);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not start a session.', 'bad');
      }
    },
    [notify]
  );

  const restartSession: Ctx['restartSession'] = useCallback(
    async (sessionId) => {
      try {
        await fetch(`/api/sessions/${sessionId}`, { method: 'POST' }).then(jsonOrThrow);
        notify('Session restarted — new MCPs and skills are loaded.', 'good');
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Could not restart.', 'bad');
      }
    },
    [notify]
  );

  const closeSession: Ctx['closeSession'] = useCallback(async (sessionId) => {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setActiveTab((current) => (current === sessionId ? 'board' : current));
  }, []);

  /* ----------------------------------------------------- terminal plumbing */

  const subscribeOutput: Ctx['subscribeOutput'] = useCallback(
    (sessionId, handler) => {
      const map = outputHandlers.current;
      if (!map.has(sessionId)) map.set(sessionId, new Set());
      map.get(sessionId)!.add(handler);
      send({ type: 'subscribe', sessionId });

      return () => {
        const handlers = map.get(sessionId);
        if (!handlers) return;
        handlers.delete(handler);
        if (handlers.size === 0) {
          map.delete(sessionId);
          send({ type: 'unsubscribe', sessionId });
        }
      };
    },
    [send]
  );

  const sendInput: Ctx['sendInput'] = useCallback(
    (sessionId, data) => send({ type: 'input', sessionId, data }),
    [send]
  );

  const sendResize: Ctx['sendResize'] = useCallback(
    (sessionId, cols, rows) => send({ type: 'resize', sessionId, cols, rows }),
    [send]
  );

  const value = useMemo<Ctx>(
    () => ({
      projects,
      cards,
      sessions,
      loading,
      connected,
      activeTab,
      setActiveTab,
      muted,
      setMuted,
      idleSince,
      screens,
      publishScreen,
      toasts,
      notify,
      dismissToast,
      addProject,
      setProjectArchived,
      removeProject,
      addCard,
      saveCard,
      moveCard,
      removeCard,
      clearColumn,
      runCard,
      openProjectSession,
      restartSession,
      closeSession,
      subscribeOutput,
      sendInput,
      sendResize,
    }),
    [
      projects,
      cards,
      sessions,
      loading,
      connected,
      activeTab,
      muted,
      idleSince,
      screens,
      publishScreen,
      toasts,
      notify,
      dismissToast,
      addProject,
      setProjectArchived,
      removeProject,
      addCard,
      saveCard,
      moveCard,
      removeCard,
      clearColumn,
      runCard,
      openProjectSession,
      restartSession,
      closeSession,
      subscribeOutput,
      sendInput,
      sendResize,
    ]
  );

  return <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>;
}
