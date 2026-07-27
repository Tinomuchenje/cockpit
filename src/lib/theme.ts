'use client';

/*
 * Theme mode: system, light or dark.
 *
 * `globals.css` used to state that the dark palette was unconditional, on the
 * grounds that light chrome around a black terminal looks broken. That is
 * true, and it is why this is not a CSS-only change: the xterm palette is
 * switched alongside the app's tokens, so the terminal is never the odd one
 * out. See XTERM_THEMES in TerminalPane.tsx.
 *
 * A tiny external store rather than context: the resolved theme is needed by
 * the terminal panes, which are deliberately kept mounted and off the normal
 * re-render path, and by an inline script that runs before React exists.
 */
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cockpit.theme';

/** Cycle order for the header control. */
const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();
let mode: ThemeMode | null = null;
let snapshot = 'system|dark';

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Private mode, or storage disabled. System is a fine default.
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(value: ThemeMode): ResolvedTheme {
  if (value === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return value;
}

export function getThemeMode(): ThemeMode {
  if (mode === null) mode = typeof window === 'undefined' ? 'system' : readStoredMode();
  return mode;
}

/**
 * Writes the theme onto <html>. `color-scheme` matters as much as the
 * attribute: it is what makes native scrollbars, form controls and the
 * browser's own canvas follow, and getting it wrong leaves white flashes
 * around the edges of an otherwise dark app.
 */
function paint(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

function refresh() {
  const current = getThemeMode();
  const resolved = resolveTheme(current);
  const next = `${current}|${resolved}`;
  if (next === snapshot) return;
  snapshot = next;
  paint(resolved);
  for (const listener of listeners) listener();
}

export function setThemeMode(value: ThemeMode) {
  mode = value;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Not worth failing the interaction over.
  }
  // paint() unconditionally: switching light -> system on a light machine
  // resolves to the same theme, so refresh() would short-circuit, but the
  // stored mode still changed and the control has to reflect it.
  paint(resolveTheme(value));
  snapshot = `${value}|${resolveTheme(value)}`;
  for (const listener of listeners) listener();
}

export function nextThemeMode(value: ThemeMode): ThemeMode {
  return ORDER[(ORDER.indexOf(value) + 1) % ORDER.length];
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  // Follow the OS while on 'system'. Without this, changing the system theme
  // does nothing until a reload.
  const media = window.matchMedia(DARK_QUERY);
  const onSystemChange = () => {
    if (getThemeMode() === 'system') refresh();
  };
  media.addEventListener('change', onSystemChange);

  // Another window of the same app is the same board; keep them in step.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    mode = readStoredMode();
    refresh();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot() {
  const current = getThemeMode();
  snapshot = `${current}|${resolveTheme(current)}`;
  return snapshot;
}

/*
 * The server cannot know the preference, so it renders the dark default and
 * React swaps in the real value after hydration. That is what getServerSnapshot
 * is for, and it is why this does not warn about a mismatch. The inline script
 * in layout.tsx has already painted the correct theme by then, so only this
 * hook's consumers (an icon and the xterm palette) settle a beat later.
 */
function getServerSnapshot() {
  return 'system|dark';
}

export function useTheme() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [themeMode, resolved] = value.split('|') as [ThemeMode, ResolvedTheme];
  return { mode: themeMode, resolved, setMode: setThemeMode };
}

/**
 * Runs before first paint, inlined in the document head. Without it the page
 * renders dark and then snaps to light, which is worse than having no light
 * mode at all. Kept dependency-free and defensive because it runs outside
 * React, before anything else on the page.
 */
export const THEME_BOOT_SCRIPT = `
try {
  var m = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) || 'system';
  var dark = m === 'dark' || (m !== 'light' && matchMedia('${DARK_QUERY}').matches);
  var r = document.documentElement;
  r.dataset.theme = dark ? 'dark' : 'light';
  r.style.colorScheme = dark ? 'dark' : 'light';
} catch (e) {}
`.trim();
