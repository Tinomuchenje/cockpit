'use client';

import { useRef } from 'react';
import type { Card, Project, Session } from '@/lib/types';
import { STATUS_LABEL } from '@/lib/types';
import { projectColor } from '@/lib/projectColor';
import { Button, StatusDot, cx, statusTextClass } from './ui';

export function CardTile({
  card,
  project,
  projectIndex,
  session,
  isDragging,
  showProjectTag,
  onDragStart,
  onDragEnd,
  onRun,
  onOpenSession,
  onOpenCard,
}: {
  card: Card;
  project: Project | undefined;
  projectIndex: number;
  session: Session | undefined;
  isDragging: boolean;
  showProjectTag: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRun: () => void;
  onOpenSession: () => void;
  onOpenCard: () => void;
}) {
  const colors = projectColor(projectIndex);
  const isLive = session && session.status !== 'exited' && session.status !== 'cancelled';

  /*
   * Chrome usually suppresses click after a drag, but not universally — and a
   * card that opens its editor every time you finish dragging it is maddening.
   * Cheap insurance.
   */
  const draggedRef = useRef(false);

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/cockpit-card', card.id);
        e.dataTransfer.effectAllowed = 'move';
        draggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={() => {
        onDragEnd();
        // Release the guard after the click that would follow this drag.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onOpenCard();
      }}
      className={cx(
        'cp-card group relative cursor-pointer rounded-xl border border-line bg-raised p-3',
        'hover:border-line-strong hover:shadow-lg hover:shadow-black/30',
        isDragging && 'cp-dragging'
      )}
    >
      {/* Left edge carries the project colour so lanes read at a glance. */}
      <span
        className={cx(
          'absolute left-0 top-3 bottom-3 w-0.5 rounded-full opacity-70',
          colors.bar
        )}
      />

      <div className="pl-2">
        <div className="flex items-start justify-between gap-2">
          {showProjectTag && project && (
            <span
              className={cx(
                'rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide',
                colors.tag
              )}
            >
              {project.displayName}
            </span>
          )}
          {session && (
            <span
              className={cx(
                'ml-auto flex items-center gap-1.5 text-[10px] font-medium',
                statusTextClass(session.status)
              )}
            >
              <StatusDot status={session.status} />
              {STATUS_LABEL[session.status]}
            </span>
          )}
        </div>

        <h4 className="mt-1.5 text-sm font-medium leading-snug text-ink">{card.title}</h4>

        {card.description && (
          <p className="cp-line-clamp-2 mt-1 text-xs leading-relaxed text-muted">
            {card.description}
          </p>
        )}

        {/* Actions stay hidden until hover/focus to keep the board calm. */}
        <div className="mt-2.5 flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {isLive ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSession();
              }}
            >
              Open session
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={(e) => {
                e.stopPropagation();
                onRun();
              }}
              title="Start a Claude Code session in this project"
            >
              <PlayIcon /> Run
            </Button>
          )}
          <span className="text-[10px] text-faint">click card to edit</span>
        </div>
      </div>
    </article>
  );
}

function PlayIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor" aria-hidden>
      <path d="M0 0.6v8.8a.5.5 0 0 0 .77.42l7-4.4a.5.5 0 0 0 0-.84l-7-4.4A.5.5 0 0 0 0 .6Z" />
    </svg>
  );
}
