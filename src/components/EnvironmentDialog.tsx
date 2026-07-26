'use client';

import { useEffect, useState } from 'react';
import type { Project } from '@/lib/types';
import type { Environment, McpServerInfo, SkillInfo } from '@/lib/environment';
import { Button, Dialog, cx } from './ui';

type Tab = 'skills' | 'mcp' | 'plugins';

/**
 * Read-only view of what a session in this project will actually have: skills,
 * MCP servers, plugins.
 *
 * Read-only on purpose. Claude Code owns these files and writes them while it's
 * running, so editing from here would race its own writes. Changing config also
 * needs a respawn to take effect, which is what the Restart button on a session
 * is for.
 */
export function EnvironmentDialog({
  project,
  onClose,
}: {
  project: Project | undefined;
  onClose: () => void;
}) {
  const [env, setEnv] = useState<Environment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('skills');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const url = project
      ? `/api/environment?projectId=${encodeURIComponent(project.id)}`
      : '/api/environment';
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Could not read the configuration.');
        return body;
      })
      .then((data) => {
        if (!cancelled) setEnv(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const needle = filter.trim().toLowerCase();
  const skills = (env?.skills ?? []).filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      s.description.toLowerCase().includes(needle) ||
      (s.group ?? '').toLowerCase().includes(needle)
  );
  const servers = (env?.mcpServers ?? []).filter(
    (s) => !needle || s.name.toLowerCase().includes(needle)
  );
  const plugins = (env?.plugins ?? []).filter(
    (p) => !needle || p.name.toLowerCase().includes(needle)
  );

  /*
   * Only locally-configured servers get flagged as a problem. The needs-auth
   * cache is mostly claude.ai connectors that may never have been intended for
   * this machine — counting those would make the warning meaningless.
   */
  const localNeedingAuth = (env?.mcpServers ?? []).filter(
    (s) => s.needsAuth && s.scope !== 'connector'
  ).length;

  const counts = {
    skills: env?.skills.length ?? 0,
    mcp: env?.mcpServers.length ?? 0,
    plugins: env?.plugins.length ?? 0,
  };

  return (
    <Dialog
      title={project ? `Environment · ${project.displayName}` : 'Environment'}
      description="What a Claude Code session here can reach. Read-only."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && (
        <p className="rounded-lg border border-dead/25 bg-dead/10 px-3 py-2 text-xs text-dead">
          {error}
        </p>
      )}

      {!env && !error && <p className="py-6 text-center text-xs text-faint">Reading…</p>}

      {env && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 rounded-lg bg-base p-0.5">
              {(['skills', 'mcp', 'plugins'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cx(
                    'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    tab === t ? 'bg-raised text-ink' : 'text-muted hover:text-ink'
                  )}
                >
                  {t === 'mcp' ? 'MCP' : t}
                  <span className="ml-1.5 text-faint">{counts[t]}</span>
                </button>
              ))}
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="ml-auto w-40 rounded-lg border border-line bg-base px-2.5 py-1 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>

          {localNeedingAuth > 0 && (
            <p className="rounded-lg border border-waiting/25 bg-waiting/[0.08] px-3 py-2 text-xs text-waiting">
              {localNeedingAuth} configured MCP{' '}
              {localNeedingAuth === 1 ? 'server needs' : 'servers need'} authenticating.
              Run <code className="font-mono">/mcp</code> in a session.
            </p>
          )}

          {env.notes.map((note) => (
            <p key={note} className="text-xs text-faint">
              {note}
            </p>
          ))}

          <div className="max-h-[46vh] space-y-1.5 overflow-y-auto">
            {tab === 'skills' &&
              (skills.length === 0 ? (
                <Empty>No skills{needle && ' match that'}.</Empty>
              ) : (
                skills.map((s) => <SkillRow key={`${s.group}/${s.name}`} skill={s} />)
              ))}

            {tab === 'mcp' &&
              (servers.length === 0 ? (
                <Empty>
                  No MCP servers{needle ? ' match that' : ' configured for this project'}.
                </Empty>
              ) : (
                servers.map((s) => <ServerRow key={s.name} server={s} />)
              ))}

            {tab === 'plugins' &&
              (plugins.length === 0 ? (
                <Empty>No plugins{needle && ' match that'}.</Empty>
              ) : (
                plugins.map((p) => (
                  <div
                    key={`${p.name}@${p.marketplace}`}
                    className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2"
                  >
                    <span className="text-xs font-medium text-ink">{p.name}</span>
                    {p.version && (
                      <span className="font-mono text-[10px] text-faint">v{p.version}</span>
                    )}
                    <span className="text-[10px] text-faint">{p.marketplace}</span>
                    <span
                      className={cx(
                        'ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium',
                        p.enabled
                          ? 'bg-live/10 text-live'
                          : 'bg-raised text-faint border border-line'
                      )}
                    >
                      {p.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </div>
                ))
              ))}
          </div>

          {tab === 'plugins' && env.plugins.some((p) => !p.enabled) && (
            <p className="text-[11px] leading-relaxed text-faint">
              Skills from disabled plugins aren&apos;t listed under Skills — a session
              can&apos;t use them.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

const SOURCE_STYLE: Record<SkillInfo['source'], string> = {
  user: 'bg-raised text-muted border border-line',
  project: 'bg-accent-dim text-accent-hot',
  plugin: 'bg-[#1e3a5f] text-[#93c5fd]',
};

function SkillRow({ skill }: { skill: SkillInfo }) {
  const [open, setOpen] = useState(false);
  // Descriptions run to 1500+ characters, so collapse by default.
  const long = skill.description.length > 150;

  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-ink">{skill.name}</code>
        {skill.group && <span className="text-[10px] text-faint">{skill.group}</span>}
        <span
          className={cx(
            'ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium',
            SOURCE_STYLE[skill.source]
          )}
        >
          {skill.source}
        </span>
      </div>
      {skill.description && (
        <p
          className={cx(
            'mt-1 text-[11px] leading-relaxed text-muted',
            !open && long && 'cp-line-clamp-2'
          )}
        >
          {skill.description}
        </p>
      )}
      {long && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-1 text-[10px] text-faint transition-colors hover:text-muted"
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

function ServerRow({ server }: { server: McpServerInfo }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2">
      <span className="text-xs font-medium text-ink">{server.name}</span>
      <span className="font-mono text-[10px] text-faint">{server.transport}</span>
      {server.detail && (
        <span className="truncate font-mono text-[10px] text-faint">{server.detail}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {server.needsAuth && (
          <span
            className={cx(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              // A connector needing auth is informational; a configured server
              // needing auth is something to act on.
              server.scope === 'connector'
                ? 'bg-raised text-faint border border-line'
                : 'bg-waiting/10 text-waiting'
            )}
          >
            needs auth
          </span>
        )}
        <span className="rounded border border-line bg-raised px-1.5 py-0.5 text-[10px] text-faint">
          {server.scope}
        </span>
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-faint">{children}</p>;
}
