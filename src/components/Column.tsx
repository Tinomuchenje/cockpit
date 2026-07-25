'use client';

import { useState } from 'react';
import type { Card, ColumnId, Project, Session } from '@/lib/types';
import { CardTile } from './CardTile';
import { useCockpit } from './CockpitProvider';
import { Button, Dialog, cx } from './ui';

/** Done piles up, so only the newest are rendered until you ask for the rest. */
const COLLAPSE_AFTER = 15;

/**
 * A board column. Handles its own drop targeting: it works out where in the
 * list the dragged card would land and shows an insertion line there, so the
 * drop is never a guess.
 */
export function Column({
  column,
  cards,
  projects,
  sessionByCardId,
  draggingCardId,
  showProjectTags,
  onDropCard,
  onDragStartCard,
  onDragEndCard,
  onRunCard,
  onOpenSession,
  onOpenCard,
  onAddCard,
}: {
  column: { id: ColumnId; label: string; hint: string };
  cards: Card[];
  projects: Project[];
  sessionByCardId: Map<string, Session>;
  draggingCardId: string | null;
  showProjectTags: boolean;
  onDropCard: (cardId: string, column: ColumnId, index: number) => void;
  onDragStartCard: (cardId: string) => void;
  onDragEndCard: () => void;
  onRunCard: (cardId: string) => void;
  onOpenSession: (cardId: string) => void;
  onOpenCard: (card: Card) => void;
  onAddCard: (column: ColumnId) => void;
}) {
  const { clearColumn } = useCockpit();
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  /*
   * Whether this drag is one of our cards, read off the dataTransfer rather
   * than React state. During a drag the browser exposes `types` (but not
   * values), and it's available on the very first dragover — whereas a state
   * flag set in dragstart may not have re-rendered yet. Gating preventDefault
   * on state meant a fast drag never marked the column as a valid drop target,
   * so no drop event fired at all and the card silently sprang back.
   */
  function carriesCard(e: React.DragEvent<HTMLElement>) {
    return e.dataTransfer.types.includes('text/cockpit-card');
  }

  /** Insertion index from the pointer's Y against each card's midpoint. */
  function indexFromPointer(e: React.DragEvent<HTMLElement>) {
    const tiles = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card-slot]')];
    for (let i = 0; i < tiles.length; i++) {
      const box = tiles[i].getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) return i;
    }
    return tiles.length;
  }

  const collapsible = cards.length > COLLAPSE_AFTER;
  const shown = collapsible && !expanded ? cards.slice(-COLLAPSE_AFTER) : cards;
  const hiddenCount = cards.length - shown.length;

  return (
    <section
      className="flex min-w-[272px] flex-1 flex-col"
      onDragEnter={(e) => {
        if (carriesCard(e)) e.preventDefault();
      }}
      onDragOver={(e) => {
        if (!carriesCard(e)) return;
        // preventDefault is what marks this element as a valid drop target.
        // Without it the browser cancels the drop and onDrop never runs.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setInsertAt(indexFromPointer(e));
      }}
      onDragLeave={(e) => {
        // Ignore the events fired while crossing child elements.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setInsertAt(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData('text/cockpit-card');
        const index = insertAt ?? indexFromPointer(e);
        setInsertAt(null);
        // With a collapsed column the visible tiles are only the tail, so
        // offset the index back into the full list.
        if (cardId) onDropCard(cardId, column.id, index + (cards.length - shown.length));
      }}
    >
      <header className="group/head mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {column.label}
          </h3>
          <span className="rounded-full bg-raised px-1.5 text-[10px] font-medium text-faint">
            {cards.length}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {column.id === 'done' && cards.length > 0 && (
            <button
              onClick={() => setConfirmClear(true)}
              title="Delete every card in Done"
              className="rounded-md px-1.5 py-1 text-[10px] font-medium text-faint opacity-0 transition-all duration-150 hover:bg-hover hover:text-dead focus-visible:opacity-100 group-hover/head:opacity-100"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => onAddCard(column.id)}
            title={`Add a card to ${column.label}`}
            className="rounded-md p-1 text-faint opacity-0 transition-all duration-150 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover/head:opacity-100"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className={cx(
          'flex flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-dashed p-2 transition-colors duration-150',
          insertAt !== null
            ? 'border-accent/50 bg-accent/[0.06]'
            : draggingCardId !== null
              ? 'border-line-strong bg-surface/40'
              : 'border-transparent bg-surface/40'
        )}
      >
        {cards.length === 0 && insertAt === null && (
          <button
            onClick={() => onAddCard(column.id)}
            className="group/empty flex flex-col items-center gap-1 rounded-lg px-1 py-6 text-center transition-colors hover:bg-hover/50"
          >
            <span className="text-[11px] leading-relaxed text-faint">{column.hint}</span>
            <span className="text-[11px] font-medium text-faint opacity-0 transition-opacity group-hover/empty:opacity-100">
              + Add a card
            </span>
          </button>
        )}

        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            Show {hiddenCount} older {hiddenCount === 1 ? 'card' : 'cards'}
          </button>
        )}

        {shown.map((card, i) => {
          const projectIndex = projects.findIndex((p) => p.id === card.projectId);
          return (
            <div key={card.id} data-card-slot>
              {insertAt === i && <InsertionLine />}
              <CardTile
                card={card}
                project={projects[projectIndex]}
                projectIndex={projectIndex}
                session={sessionByCardId.get(card.id)}
                isDragging={draggingCardId === card.id}
                showProjectTag={showProjectTags}
                onDragStart={() => onDragStartCard(card.id)}
                onDragEnd={() => {
                  setInsertAt(null);
                  onDragEndCard();
                }}
                onRun={() => onRunCard(card.id)}
                onOpenSession={() => onOpenSession(card.id)}
                onOpenCard={() => onOpenCard(card)}
              />
            </div>
          );
        })}

        {insertAt === shown.length && <InsertionLine />}
      </div>

      {confirmClear && (
        <Dialog
          title={`Clear ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} from Done?`}
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await clearColumn('done');
                  setConfirmClear(false);
                }}
              >
                Clear Done
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-muted">
            Deletes these cards from the board for good. Your code, commits and git
            history are untouched — this only clears the task list.
          </p>
        </Dialog>
      )}
    </section>
  );
}

function InsertionLine() {
  return (
    <div className="relative my-1 h-0.5 rounded-full bg-accent">
      <span className="absolute -left-0.5 -top-[3px] h-2 w-2 rounded-full bg-accent" />
    </div>
  );
}
