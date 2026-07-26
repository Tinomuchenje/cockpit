import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/db';
import { readEnvironment } from '@/lib/environment';

/**
 * What a session in this project will actually have available: skills, MCP
 * servers, plugins.
 *
 * Read-only, and everything sensitive is stripped in readEnvironment() before it
 * gets here — MCP configs can hold API keys in `env`, bearer tokens in
 * `headers`, or a token in a URL query. Only a transport label and a bare
 * command name or hostname are exposed.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId');

  let projectPath: string | undefined;
  if (projectId) {
    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    projectPath = project.folderPath;
  }

  try {
    return NextResponse.json(readEnvironment(projectPath));
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Could not read the Claude Code configuration.',
      },
      { status: 500 }
    );
  }
}
