'use client';

/*
 * The first-run explanation. Most people who open an app never read its README,
 * and Cockpit's model — cards are prompts, columns are session state, sessions
 * outlive the tab — is not guessable from an empty board.
 *
 * Deliberately not a changelog or a settings screen. It answers "what is this
 * and how do I drive it", and nothing else.
 */

import { Button, Dialog, Kbd } from './ui';

const COLUMNS = [
  ['To Do', 'Created, not started.'],
  ['In Progress', 'A card lands here on its own when you run it.'],
  ['Review', 'Work done, checking it over. You move cards here.'],
  ['Done', 'Committed and pushed. You move cards here.'],
];

const STATUSES: [string, string, string][] = [
  ['bg-live', 'Running', 'Producing output, so it is working.'],
  ['bg-waiting', 'Waiting', 'Quiet for a few seconds, so it wants you.'],
  ['bg-faint', 'Exited', 'The process ended.'],
];

const SHORTCUTS: [React.ReactNode, string][] = [
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>1</Kbd>
    </>,
    'Jump to the board',
  ],
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>2</Kbd>–<Kbd>9</Kbd>
    </>,
    'Jump to the nth session',
  ],
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>+</Kbd> / <Kbd>-</Kbd>
    </>,
    'Zoom the terminal, not the page',
  ],
  [
    <>
      <Kbd>Enter</Kbd>
    </>,
    'Send from the prompt box',
  ],
  [
    <>
      <Kbd>Shift</Kbd> <Kbd>Enter</Kbd>
    </>,
    'Newline instead of sending',
  ],
  [
    <>
      <Kbd>Esc</Kbd>
    </>,
    'Close a dialog, or hand focus to the terminal',
  ],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-0 first:pt-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="What Cockpit does"
      description="Run Claude Code across several projects from one window."
      onClose={onClose}
      wide
      footer={
        <>
          <a
            href="https://github.com/Tinomuchenje/cockpit"
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-1.5 text-xs text-muted transition-colors hover:bg-hover hover:text-ink"
          >
            GitHub
          </a>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <Section title="The idea">
          <p className="leading-relaxed text-muted">
            Working across several repos normally means opening an editor, picking a
            workspace, starting Claude Code, pasting context, waiting, then repeating
            the whole ceremony for the next project. Cockpit collapses that into one
            window and one board.
          </p>
        </Section>

        <Section title="Three things to know">
          <dl className="space-y-2.5 text-muted">
            <div>
              <dt className="font-medium text-ink">A project is a folder you already have.</dt>
              <dd className="leading-relaxed">
                Cockpit never clones anything. It points at what is on disk.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-ink">A card&apos;s description is the prompt.</dt>
              <dd className="leading-relaxed">
                Give it a body and acceptance criteria, not a one-line title. Running
                the card opens a session with that text pre-filled and{' '}
                <span className="text-ink">waits</span> — nothing is sent until you
                press Send, so you can edit it first.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Sessions live in the backend.</dt>
              <dd className="leading-relaxed">
                Switch tabs, navigate away, reload the page: the{' '}
                <code className="rounded bg-raised px-1 py-0.5 text-[11px]">claude</code>{' '}
                process keeps running and the scrollback replays when you come back.
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="Columns are session state">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
            {COLUMNS.map(([name, meaning]) => (
              <div key={name} className="contents">
                <dt className="whitespace-nowrap font-medium text-ink">{name}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Session badges">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
            {STATUSES.map(([dot, name, meaning]) => (
              <div key={name} className="contents">
                <dt className="flex items-center gap-2 whitespace-nowrap font-medium text-ink">
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {name}
                </dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2.5 leading-relaxed text-faint">
            When a session goes quiet it is flagged as waiting, the tab badges and a
            chime plays. The attention panel at the top of the board shows what is
            actually on its screen so you can answer without switching tabs.
          </p>
        </Section>

        <Section title="Shortcuts">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-muted">
            {SHORTCUTS.map(([keys, meaning], i) => (
              <div key={i} className="contents">
                <dt className="whitespace-nowrap">{keys}</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="One thing to be careful about">
          <p className="leading-relaxed text-muted">
            Cockpit listens on your machine only, and it has no login. Anything that
            can reach it can browse your filesystem and start shells as you. Do not
            put it on a network address without adding authentication first.
          </p>
        </Section>
      </div>
    </Dialog>
  );
}
