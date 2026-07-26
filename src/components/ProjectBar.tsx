'use client';

import { useState } from 'react';
import { useCockpit } from './CockpitProvider';
import { projectColor } from '@/lib/projectColor';
import { EnvironmentDialog } from './EnvironmentDialog';
import { Button, Dialog, cx } from './ui';

/** Filter pills across the top, plus the two primary actions. */
export function ProjectBar({
  projectFilter,
  onFilterChange,
  showArchived,
  onToggleArchived,
  onAddProject,
  onNewCard,
}: {
  projectFilter: string;
  onFilterChange: (value: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onAddProject: () => void;
  onNewCard: () => void;
}) {
  const { projects, cards, openProjectSession, removeProject, setProjectArchived } =
    useCockpit();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [showEnvironment, setShowEnvironment] = useState(false);

  const project = projects.find((p) => p.id === projectFilter);
  const archivedCount = projects.filter((p) => p.archived).length;
  const pills = projects.filter((p) => showArchived || !p.archived);

  const affectedCards = cards.filter((c) => c.projectId === confirmRemove).length;
  const removing = projects.find((p) => p.id === confirmRemove);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-1">
        <FilterPill
          active={projectFilter === 'all'}
          onClick={() => onFilterChange('all')}
          label="All projects"
        />
        {pills.map((p) => (
          <FilterPill
            key={p.id}
            active={projectFilter === p.id}
            onClick={() => onFilterChange(p.id)}
            label={p.displayName}
            dotClass={projectColor(projects.indexOf(p)).bar}
            dimmed={p.archived}
          />
        ))}
        {archivedCount > 0 && (
          <button
            onClick={onToggleArchived}
            className="ml-1 rounded-lg px-2 py-1.5 text-[11px] text-faint transition-colors hover:bg-hover hover:text-muted"
          >
            {showArchived ? 'Hide archived' : `${archivedCount} archived`}
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {project && (
          <>
            <span
              className="max-w-[240px] truncate font-mono text-[11px] text-faint"
              title={project.folderPath}
            >
              {project.folderPath}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openProjectSession(project.id)}
              title="Open a session in this project without a card"
            >
              Open terminal
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const nowArchived = !project.archived;
                await setProjectArchived(project.id, nowArchived);
                // Archiving the project you're filtered by would otherwise
                // leave you staring at an empty board with no explanation.
                if (nowArchived) onFilterChange('all');
              }}
              title={
                project.archived
                  ? 'Put this project back on the board'
                  : 'Hide this project and its cards from the board'
              }
            >
              {project.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-faint hover:text-dead"
              onClick={() => setConfirmRemove(project.id)}
            >
              Remove
            </Button>
            <span className="mx-1 h-5 w-px bg-line" />
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowEnvironment(true)}
          title="Skills, MCP servers and plugins available to sessions here"
        >
          Environment
        </Button>
        <Button size="sm" variant="secondary" onClick={onAddProject}>
          Add project
        </Button>
        <Button size="sm" variant="primary" onClick={onNewCard}>
          New card
        </Button>
      </div>

      {showEnvironment && (
        <EnvironmentDialog project={project} onClose={() => setShowEnvironment(false)} />
      )}

      {confirmRemove && removing && (
        <Dialog
          title={`Remove ${removing.displayName}?`}
          onClose={() => setConfirmRemove(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await setProjectArchived(confirmRemove, true);
                  setConfirmRemove(null);
                  onFilterChange('all');
                }}
              >
                Archive instead
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await removeProject(confirmRemove);
                  setConfirmRemove(null);
                  onFilterChange('all');
                }}
              >
                Remove project
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-muted">
            This removes the project from Cockpit along with{' '}
            <strong className="text-ink">
              {affectedCards} {affectedCards === 1 ? 'card' : 'cards'}
            </strong>
            , and closes any live session in it. Nothing on disk is touched — the folder
            and its git history stay exactly as they are.
          </p>
          <p className="mt-2 text-xs text-faint">
            Archiving keeps the cards and just hides them from the board.
          </p>
        </Dialog>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  dotClass,
  dimmed,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dotClass?: string;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150',
        active ? 'bg-raised text-ink' : 'text-muted hover:bg-hover hover:text-ink',
        dimmed && 'opacity-50'
      )}
    >
      {dotClass && <span className={cx('h-1.5 w-1.5 rounded-full', dotClass)} />}
      {label}
      {dimmed && <span className="text-[9px] uppercase tracking-wide">archived</span>}
    </button>
  );
}
