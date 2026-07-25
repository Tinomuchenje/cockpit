import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Server-side directory listing, so "Add project" can offer a real folder
 * picker.
 *
 * This has to happen on the server: a browser physically cannot hand us an
 * absolute path. showDirectoryPicker() returns an opaque handle with only a
 * name, and <input webkitdirectory> exposes relative paths. We need a real
 * path to use as a PTY cwd, so the backend walks the filesystem instead.
 *
 * Only reachable from loopback — see the bind address in server.js.
 */

/** Windows has no API for enumerating drives, so probe the letters. */
function listDrives() {
  if (process.platform !== 'win32') return [];
  const drives: { name: string; path: string }[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) drives.push({ name: `${letter}:`, path: root });
    } catch {
      // Unreadable or disconnected drive; skip it.
    }
  }
  return drives;
}

function isGitRepo(dir: string) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('path');
  const target = requested ? path.resolve(requested) : os.homedir();

  if (!fs.existsSync(target)) {
    return NextResponse.json(
      { error: `That folder doesn't exist: ${target}` },
      { status: 404 }
    );
  }
  if (!fs.statSync(target).isDirectory()) {
    return NextResponse.json({ error: 'That path is a file, not a folder.' }, { status: 400 });
  }

  let entries: { name: string; path: string; isGitRepo: boolean }[] = [];
  try {
    entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => {
        // Directories only (we're picking a folder), and skip dot-folders —
        // .git/.next/.cache are noise when you're looking for a project.
        if (!entry.isDirectory()) return false;
        return !entry.name.startsWith('.');
      })
      .map((entry) => {
        const full = path.join(target, entry.name);
        return { name: entry.name, path: full, isGitRepo: isGitRepo(full) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return NextResponse.json(
        { error: "You don't have permission to read that folder." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: 'Could not read that folder.' }, { status: 500 });
  }

  const parent = path.dirname(target);

  return NextResponse.json({
    path: target,
    // At a filesystem root dirname() returns the same path; treat that as no parent.
    parentPath: parent === target ? null : parent,
    isGitRepo: isGitRepo(target),
    entries,
    drives: listDrives(),
    homePath: os.homedir(),
  });
}
