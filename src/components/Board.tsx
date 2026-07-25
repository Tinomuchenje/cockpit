'use client';

import { useMemo, useState } from 'react';
import { COLUMNS, type Card, type ColumnId } from '@/lib/types';
import { useCockpit } from './CockpitProvider';
import { Column } from './Column';
import { AddProjectDialog } from './AddProjectDialog';
import { CardDialog } from './CardDialog';
import { ProjectBar } from './ProjectBar';
import { AttentionPanel } from './AttentionPanel';
import { Button, EmptyState } from './ui';

export function Board() {
  const {
    projects,
    cards,
    sessions,
    loading,
    moveCard,
    runCard,
    setActiveTab,
  } = useCockpit();

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [cardDialog, setCardDialog] = useState<{
    open: boolean;
    card: Card | null;
    column?: ColumnId;
  }>({ open: false, card: null });

  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);

  /** Newest live session per card, so a card shows its current state. */
  const sessionByCardId = useMemo(() => {
    const map = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (session.cardId) map.set(session.cardId, session);
    }
    return map;
  }, [sessions]);

  /* Archived projects drop off the board unless you ask to see them. */
  const visibleCards = useMemo(() => {
    const archivedIds = new Set(projects.filter((p) => p.archived).map((p) => p.id));
    let result = showArchived ? cards : cards.filter((c) => !archivedIds.has(c.projectId));
    if (projectFilter !== 'all') {
      result = result.filter((c) => c.projectId === projectFilter);
    }
    return result;
  }, [cards, projects, projectFilter, showArchived]);

  const byColumn = useMemo(() => {
    const map = new Map<ColumnId, Card[]>();
    for (const column of COLUMNS) {
      map.set(
        column.id,
        visibleCards
          .filter((c) => c.column === column.id)
          .sort((a, b) => a.position - b.position)
      );
    }
    return map;
  }, [visibleCards]);

  /*
   * Turn a drop index into a fractional position between its new neighbours.
   * Fractional positions keep a reorder to a single-row update — no
   * renumbering the whole column.
   */
  function handleDrop(cardId: string, column: ColumnId, index: number) {
    setDraggingCardId(null);

    const target = (byColumn.get(column) ?? []).filter((c) => c.id !== cardId);
    const before = target[index - 1];
    const after = target[index];

    const lower = before?.position ?? 0;
    const upper = after?.position ?? lower + 2000;
    const position = (lower + upper) / 2;

    const card = cards.find((c) => c.id === cardId);
    if (card && card.column === column && card.position === position) return;

    void moveCard(cardId, column, position);
  }

  function openSessionForCard(cardId: string) {
    const session = sessionByCardId.get(cardId);
    if (session) setActiveTab(session.id);
  }

  if (loading) return <BoardSkeleton />;

  if (projects.length === 0) {
    return (
      <>
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<FolderIcon />}
            title="Add your first project"
            action={
              <Button variant="primary" onClick={() => setShowAddProject(true)}>
                Add a project
              </Button>
            }
          >
            Point Cockpit at a folder you&apos;ve already cloned. Then create a card
            describing a task, and hit Run to open a live Claude Code session in that
            folder.
          </EmptyState>
        </div>
        {showAddProject && <AddProjectDialog onClose={() => setShowAddProject(false)} />}
      </>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ProjectBar
        projectFilter={projectFilter}
        onFilterChange={setProjectFilter}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        onAddProject={() => setShowAddProject(true)}
        onNewCard={() => setCardDialog({ open: true, card: null, column: 'todo' })}
      />

      <AttentionPanel
        sessions={sessions}
        cards={cards}
        projects={projects}
        onOpenSession={setActiveTab}
      />

      {visibleCards.length === 0 && cards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<CardsIcon />}
            title="No cards yet"
            action={
              <Button
                variant="primary"
                onClick={() => setCardDialog({ open: true, card: null, column: 'todo' })}
              >
                Create your first card
              </Button>
            }
          >
            A card is one task in one project. Give it a description with acceptance
            criteria, then hit Run — a session opens in that project&apos;s folder with the
            description ready to send.
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4">
          {COLUMNS.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={byColumn.get(column.id) ?? []}
              projects={projects}
              sessionByCardId={sessionByCardId}
              draggingCardId={draggingCardId}
              showProjectTags={projectFilter === 'all'}
              onDropCard={handleDrop}
              onDragStartCard={setDraggingCardId}
              onDragEndCard={() => setDraggingCardId(null)}
              onRunCard={(cardId) => void runCard(cardId)}
              onOpenSession={openSessionForCard}
              onOpenCard={(card) => setCardDialog({ open: true, card })}
              onAddCard={(columnId) =>
                setCardDialog({ open: true, card: null, column: columnId })
              }
            />
          ))}
        </div>
      )}

      {showAddProject && <AddProjectDialog onClose={() => setShowAddProject(false)} />}
      {cardDialog.open && (
        <CardDialog
          card={cardDialog.card}
          defaultColumn={cardDialog.column}
          defaultProjectId={projectFilter !== 'all' ? projectFilter : undefined}
          projects={activeProjects.length > 0 ? activeProjects : projects}
          onClose={() => setCardDialog({ open: false, card: null })}
        />
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 gap-3 px-4 pt-14">
      {COLUMNS.map((column) => (
        <div key={column.id} className="flex min-w-[272px] flex-1 flex-col gap-2">
          <div className="h-3 w-20 rounded bg-raised" />
          <div className="h-24 rounded-xl bg-surface/60" />
          <div className="h-24 rounded-xl bg-surface/40" />
        </div>
      ))}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="4" width="7" height="16" rx="1.5" />
      <rect x="14" y="4" width="7" height="9" rx="1.5" />
    </svg>
  );
}
