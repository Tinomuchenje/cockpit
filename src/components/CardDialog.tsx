'use client';

import { useState } from 'react';
import { COLUMNS, type Card, type ColumnId, type Project } from '@/lib/types';
import { useCockpit } from './CockpitProvider';
import { Button, Dialog, Field, Input, Select, Textarea } from './ui';

/**
 * Create or edit a card. The description matters: it becomes the prompt the
 * session is pre-filled with, so the placeholder pushes for acceptance
 * criteria rather than a one-liner.
 */
export function CardDialog({
  card,
  projects,
  defaultProjectId,
  defaultColumn,
  onClose,
}: {
  card: Card | null;
  projects: Project[];
  defaultProjectId?: string;
  defaultColumn?: ColumnId;
  onClose: () => void;
}) {
  const { addCard, saveCard, removeCard, runCard } = useCockpit();
  const editing = card !== null;

  const [title, setTitle] = useState(card?.title ?? '');
  const [description, setDescription] = useState(card?.description ?? '');
  const [projectId, setProjectId] = useState(
    card?.projectId ?? defaultProjectId ?? projects[0]?.id ?? ''
  );
  const [column, setColumn] = useState<ColumnId>(card?.column ?? defaultColumn ?? 'todo');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await saveCard(card.id, { title: title.trim(), description, column });
      } else {
        await addCard({ projectId, title: title.trim(), description, column });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that card.');
      setSaving(false);
    }
  }

  async function saveThenRun() {
    if (!card) return;
    setSaving(true);
    try {
      await saveCard(card.id, { title: title.trim(), description, column });
      await runCard(card.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a session.');
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!card) return;
    setSaving(true);
    try {
      await removeCard(card.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that card.');
      setSaving(false);
    }
  }

  if (projects.length === 0) {
    return (
      <Dialog title="No projects yet" onClose={onClose}>
        <p className="text-sm text-muted">Add a project before creating cards.</p>
      </Dialog>
    );
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title={editing ? card.title || 'Edit card' : 'New card'}
        description={
          editing
            ? undefined
            : 'The description is pre-filled into the session prompt when you hit Run.'
        }
        onClose={onClose}
        footer={
          <>
            {editing && (
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                className="mr-auto"
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                disabled={saving || !title.trim()}
                onClick={saveThenRun}
              >
                Save &amp; run
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !title.trim()}
              onClick={() => submit()}
            >
              {saving ? 'Saving…' : editing ? 'Save' : 'Create card'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {!editing && (
              <Field label="Project">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Column">
              <Select
                value={column}
                onChange={(e) => setColumn(e.target.value as ColumnId)}
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fix the SSO login redirect"
              required
            />
          </Field>

          <Field
            label="Description"
            hint="Give it a body and acceptance criteria — a thin prompt just means more back-and-forth."
          >
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              placeholder={
                'What needs doing, and how you\'ll know it\'s right.\n\n' +
                'e.g. Users signing in via SSO land on /login instead of the\n' +
                'dashboard. Fix the redirect and add a test covering the\n' +
                'callback path.'
              }
            />
          </Field>

          {error && (
            <p className="rounded-lg border border-dead/25 bg-dead/10 px-3 py-2 text-xs text-dead">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </form>
  );
}
