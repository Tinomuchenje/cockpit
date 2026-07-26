import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Reads what Claude Code will actually have available in a given project:
 * skills, MCP servers, and plugins.
 *
 * Strictly read-only. Claude Code owns these files and writes them while it
 * runs, so editing them from here would race its own writes.
 *
 * Everything is discovered on demand rather than cached — the whole point is to
 * reflect the current state, and it's a few dozen small file reads.
 */

export type SkillInfo = {
  name: string;
  description: string;
  /** Where it came from, which determines whether every project sees it. */
  source: 'user' | 'project' | 'plugin';
  /** Set when the skill is one of several inside a bundle or plugin. */
  group: string | null;
};

export type McpServerInfo = {
  name: string;
  scope: 'user' | 'project' | 'connector';
  /** stdio / http / sse, as far as we can tell from the config shape. */
  transport: string;
  /** A safe identifying hint — a bare command name or a hostname. Never args. */
  detail: string | null;
  needsAuth: boolean;
};

export type PluginInfo = {
  name: string;
  marketplace: string;
  version: string | null;
  scope: string | null;
  enabled: boolean;
};

export type Environment = {
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  plugins: PluginInfo[];
  /** Present when a file we expected was unreadable, so the UI can be honest. */
  notes: string[];
};

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isDir(p: string) {
  try {
    // statSync, not lstatSync: most entries in ~/.claude/skills are symlinks
    // into the real skill directories, and lstat would report them as links
    // and skip them.
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- skills */

/**
 * Pulls `name` and `description` out of a SKILL.md YAML frontmatter block.
 * Deliberately not a YAML parser: only these two keys are needed, and
 * descriptions are commonly `|` block scalars spanning many lines.
 */
function parseSkillFrontmatter(file: string): { name: string; description: string } | null {
  let raw: string;
  try {
    // Frontmatter is at the top; no need to read a whole skill document.
    // CRLF is normalised first, and that is not cosmetic: \r is a line
    // terminator in JS regex, so `.` won't match it and `$` won't match before
    // it — leaving it in makes every `key: value` line fail to parse on files
    // written on Windows, which is most of them.
    raw = fs.readFileSync(file, 'utf8').slice(0, 8192).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }

  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;

  const lines = raw.slice(raw.indexOf('\n') + 1, end).split('\n');
  const out: Record<string, string> = {};
  let currentKey: string | null = null;
  let blockLines: string[] = [];

  const flush = () => {
    if (currentKey) out[currentKey] = blockLines.join(' ').replace(/\s+/g, ' ').trim();
    currentKey = null;
    blockLines = [];
  };

  for (const line of lines) {
    const match = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(line);
    if (match) {
      flush();
      const [, key, value] = match;
      if (value === '|' || value === '>' || value === '|-' || value === '>-') {
        currentKey = key; // block scalar; body follows on indented lines
      } else {
        out[key] = value.replace(/^["']|["']$/g, '').replace(/\s*#.*$/, '').trim();
      }
    } else if (currentKey && /^\s+/.test(line)) {
      blockLines.push(line.trim());
    } else if (line.trim() === '') {
      // blank line inside a block scalar; keep going
    } else {
      flush();
    }
  }
  flush();

  const name = out.name?.trim();
  if (!name) return null;
  return { name, description: out.description?.trim() ?? '' };
}

/**
 * Collects skills from a `skills/` directory. Two layouts exist: a skill
 * directly (`skills/<name>/SKILL.md`) or a bundle of them
 * (`skills/<bundle>/<name>/SKILL.md`).
 */
function collectSkills(
  skillsDir: string,
  source: SkillInfo['source'],
  group: string | null = null
): SkillInfo[] {
  if (!isDir(skillsDir)) return [];

  const found: SkillInfo[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(skillsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry);
    if (!isDir(entryPath)) continue;

    const direct = path.join(entryPath, 'SKILL.md');
    if (fs.existsSync(direct)) {
      const meta = parseSkillFrontmatter(direct);
      if (meta) found.push({ ...meta, source, group });
      continue;
    }

    // Not a skill itself — look one level down for a bundle of them.
    let nested: string[];
    try {
      nested = fs.readdirSync(entryPath);
    } catch {
      continue;
    }
    for (const child of nested) {
      const childSkill = path.join(entryPath, child, 'SKILL.md');
      if (fs.existsSync(childSkill)) {
        const meta = parseSkillFrontmatter(childSkill);
        if (meta) found.push({ ...meta, source, group: group ?? entry });
      }
    }
  }

  return found;
}

/* ----------------------------------------------------------------- mcp */

/**
 * Reduces an MCP server config to something safe to send to the browser.
 *
 * MCP definitions routinely carry credentials — `env` with API keys, `headers`
 * with bearer tokens, or a token embedded in a URL query. So this returns a
 * transport label and one identifying hint (a bare command name or a hostname)
 * and drops everything else. Never pass the raw config through.
 */
function describeServer(name: string, config: unknown, scope: McpServerInfo['scope']) {
  const cfg = (config ?? {}) as Record<string, unknown>;
  let transport = typeof cfg.type === 'string' ? cfg.type : 'stdio';
  let detail: string | null = null;

  if (typeof cfg.url === 'string') {
    if (transport === 'stdio') transport = 'http';
    try {
      detail = new URL(cfg.url).host; // host only: the path or query may hold a token
    } catch {
      detail = null;
    }
  } else if (typeof cfg.command === 'string') {
    transport = 'stdio';
    // Bare command name, no args — args are a common place for secrets.
    detail = path.basename(cfg.command).replace(/\.(exe|cmd|bat)$/i, '');
  }

  return { name, scope, transport, detail };
}

/** Windows paths vary in case and separator; compare them normalised. */
function samePath(a: string, b: string) {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/* ------------------------------------------------------------ assemble */

export function readEnvironment(projectPath?: string): Environment {
  const notes: string[] = [];

  /* --- skills --- */
  const skills: SkillInfo[] = [
    ...collectSkills(path.join(CLAUDE_DIR, 'skills'), 'user'),
    ...(projectPath
      ? collectSkills(path.join(projectPath, '.claude', 'skills'), 'project')
      : []),
  ];

  /* --- plugins, and the skills they bring --- */
  const plugins: PluginInfo[] = [];
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json')) as {
    enabledPlugins?: Record<string, boolean>;
  } | null;
  const enabledPlugins = settings?.enabledPlugins ?? {};

  const installed = readJson(
    path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')
  ) as { plugins?: Record<string, { installPath?: string; version?: string; scope?: string }[]> } | null;

  for (const [key, installs] of Object.entries(installed?.plugins ?? {})) {
    const [name, marketplace = 'unknown'] = key.split('@');
    const install = installs?.[0] ?? {};
    const enabled = enabledPlugins[key] === true;

    plugins.push({
      name,
      marketplace,
      version: install.version ?? null,
      scope: install.scope ?? null,
      enabled,
    });

    /*
     * Only enabled plugins contribute skills. A disabled plugin still has its
     * files on disk, so scanning regardless would list skills that a session
     * cannot actually use — worse than not showing them.
     */
    if (enabled && install.installPath) {
      skills.push(...collectSkills(path.join(install.installPath, 'skills'), 'plugin', name));
    }
  }

  /* --- mcp servers --- */
  const needsAuthCache =
    (readJson(path.join(CLAUDE_DIR, 'mcp-needs-auth-cache.json')) as Record<
      string,
      unknown
    > | null) ?? {};
  const needsAuthNames = new Set(Object.keys(needsAuthCache));

  const globalConfig = readJson(path.join(HOME, '.claude.json')) as {
    mcpServers?: Record<string, unknown>;
    projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
  } | null;
  if (!globalConfig) notes.push('Could not read ~/.claude.json, so MCP servers may be missing.');

  const servers: McpServerInfo[] = [];
  const seen = new Set<string>();

  const add = (name: string, config: unknown, scope: McpServerInfo['scope']) => {
    if (seen.has(name)) return;
    seen.add(name);
    servers.push({ ...describeServer(name, config, scope), needsAuth: needsAuthNames.has(name) });
  };

  // User-wide servers. Absent in some installs, so guard rather than assume.
  for (const [name, config] of Object.entries(globalConfig?.mcpServers ?? {})) {
    add(name, config, 'user');
  }

  // Servers scoped to this project, keyed by absolute path in ~/.claude.json.
  if (projectPath) {
    const entry = Object.entries(globalConfig?.projects ?? {}).find(([p]) =>
      samePath(p, projectPath)
    );
    for (const [name, config] of Object.entries(entry?.[1]?.mcpServers ?? {})) {
      add(name, config, 'project');
    }

    // A checked-in .mcp.json is the shareable, per-repo convention.
    const projectMcp = readJson(path.join(projectPath, '.mcp.json')) as {
      mcpServers?: Record<string, unknown>;
    } | null;
    for (const [name, config] of Object.entries(projectMcp?.mcpServers ?? {})) {
      add(name, config, 'project');
    }
  }

  /*
   * Anything left in the needs-auth cache is a claude.ai connector rather than
   * local config — it won't appear above, but it's exactly what you want warned
   * about, since a session will start and only mention it in passing.
   */
  for (const name of needsAuthNames) {
    if (!seen.has(name)) {
      seen.add(name);
      servers.push({ name, scope: 'connector', transport: 'remote', detail: null, needsAuth: true });
    }
  }

  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  skills.sort((a, b) => collator.compare(a.name, b.name));
  servers.sort(
    (a, b) => Number(b.needsAuth) - Number(a.needsAuth) || collator.compare(a.name, b.name)
  );
  plugins.sort((a, b) => collator.compare(a.name, b.name));

  return { skills, mcpServers: servers, plugins, notes };
}
