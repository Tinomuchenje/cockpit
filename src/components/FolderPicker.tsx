'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, cx } from './ui';

type Listing = {
  path: string;
  parentPath: string | null;
  isGitRepo: boolean;
  entries: { name: string; path: string; isGitRepo: boolean }[];
  drives: { name: string; path: string }[];
  homePath: string;
};

/**
 * Navigate the real filesystem and pick a folder. Backed by /api/browse
 * because the browser can't give us an absolute path on its own.
 */
export function FolderPicker({
  initialPath,
  onPick,
  onCancel,
}: {
  initialPath?: string;
  onPick: (folderPath: string) => void;
  onCancel: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Starts false, not true: the mount effect kicks the fetch off asynchronously,
   * and flipping loading synchronously inside that effect would trigger a
   * cascading render. The first paint just shows an empty list for one frame.
   */
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (target?: string) => {
    // Deliberately not awaited synchronously from the mount effect — see below.
    setLoading(true);
    setError(null);
    try {
      const url = target ? `/api/browse?path=${encodeURIComponent(target)}` : '/api/browse';
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not read that folder.');
      setListing(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Queue the first fetch as a task so its setState lands outside the effect.
    const timer = setTimeout(() => void load(initialPath), 0);
    return () => clearTimeout(timer);
  }, [load, initialPath]);

  /* Breadcrumb segments, each navigable. */
  const crumbs = (() => {
    if (!listing) return [];
    const sep = listing.path.includes('\\') ? '\\' : '/';
    const parts = listing.path.split(sep).filter(Boolean);
    let acc = listing.path.startsWith(sep) ? sep : '';
    return parts.map((part, i) => {
      acc = i === 0 && sep === '\\' ? part + sep : acc + part + sep;
      return { label: part, path: acc };
    });
  })();

  return (
    <div className="flex h-[26rem] flex-col overflow-hidden rounded-xl border border-line bg-base">
      {/* toolbar */}
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!listing?.parentPath}
          onClick={() => listing?.parentPath && load(listing.parentPath)}
          title="Up one level"
        >
          <UpIcon />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => load(listing?.homePath)}>
          Home
        </Button>

        {listing && listing.drives.length > 0 && (
          <div className="flex items-center gap-1 border-l border-line pl-1.5">
            {listing.drives.map((drive) => (
              <Button
                key={drive.path}
                size="sm"
                variant="ghost"
                className="font-mono"
                onClick={() => load(drive.path)}
              >
                {drive.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* breadcrumbs */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-3 py-1.5 font-mono text-[11px]">
        {crumbs.length === 0 && <span className="text-faint">…</span>}
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-faint">/</span>}
            <button
              onClick={() => load(crumb.path)}
              className="rounded px-1 py-0.5 text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* listing */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && <p className="px-2 py-3 text-xs text-faint">Reading folder…</p>}

        {error && !loading && (
          <p className="m-2 rounded-lg border border-dead/25 bg-dead/10 px-3 py-2 text-xs text-dead">
            {error}
          </p>
        )}

        {!loading && !error && listing?.entries.length === 0 && (
          <p className="px-2 py-3 text-xs text-faint">No sub-folders here.</p>
        )}

        {!loading &&
          !error &&
          listing?.entries.map((entry) => (
            <button
              key={entry.path}
              onDoubleClick={() => load(entry.path)}
              onClick={() => load(entry.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-ink transition-colors hover:bg-hover"
            >
              <FolderIcon />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.isGitRepo && (
                <span className="rounded bg-accent-dim px-1.5 py-0.5 text-[10px] font-medium text-accent-hot">
                  git
                </span>
              )}
            </button>
          ))}
      </div>

      {/* selection */}
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] text-muted" title={listing?.path}>
            {listing?.path ?? '…'}
          </p>
          <p className="text-[10px] text-faint">
            {listing?.isGitRepo
              ? 'A git repo — you can commit and push from here.'
              : 'No .git here. Fine for running Claude, but you cannot commit.'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!listing}
          onClick={() => listing && onPick(listing.path)}
        >
          Use this folder
        </Button>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={cx('shrink-0 text-faint')}
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function UpIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
