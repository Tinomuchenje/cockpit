'use client';

import { useState } from 'react';
import { useCockpit } from './CockpitProvider';
import { FolderPicker } from './FolderPicker';
import { Button, Dialog, Field, Input } from './ui';

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { addProject } = useCockpit();
  const [displayName, setDisplayName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [stack, setStack] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  /** Default the display name to the folder's own name. */
  function applyPath(value: string) {
    setFolderPath(value);
    if (!displayName) {
      const leaf = value.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      if (leaf) setDisplayName(leaf);
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addProject({
        displayName: displayName.trim(),
        folderPath: folderPath.trim(),
        stack: stack.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that project.');
      setSaving(false);
    }
  }

  if (browsing) {
    return (
      <Dialog
        title="Choose a folder"
        description="Click to open a folder, then use it as the project root."
        onClose={() => setBrowsing(false)}
      >
        <FolderPicker
          initialPath={folderPath || undefined}
          onCancel={() => setBrowsing(false)}
          onPick={(picked) => {
            applyPath(picked);
            setBrowsing(false);
          }}
        />
      </Dialog>
    );
  }

  return (
    <form onSubmit={submit}>
      <Dialog
        title="Add a project"
        description="Point Cockpit at a folder you've already cloned locally."
        onClose={onClose}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !folderPath.trim() || !displayName.trim()}
              onClick={() => submit()}
            >
              {saving ? 'Adding…' : 'Add project'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Folder">
            <div className="flex gap-2">
              <Input
                value={folderPath}
                onChange={(e) => applyPath(e.target.value)}
                placeholder="C:\Users\you\code\my-project"
                className="font-mono text-xs"
                required
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBrowsing(true)}
                className="shrink-0"
              >
                Browse…
              </Button>
            </div>
          </Field>

          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="My Project"
              required
            />
          </Field>

          <Field label="Stack" hint="Optional label, just for your own reference.">
            <Input
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              placeholder="Next.js"
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
