import { NextRequest, NextResponse } from 'next/server';
import { deleteProject, getProject, updateProject } from '@/lib/db';
import { listLiveSessions, close as closeSession } from '@/lib/sessionManager';

export async function PATCH(
  req: NextRequest,
  { params }: RouteContext<'/api/projects/[id]'>
) {
  const { id } = await params;
  const body = await req.json();

  const updated = updateProject(id, {
    ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
    ...(body.stack !== undefined ? { stack: body.stack?.trim() || null } : {}),
    ...(body.archived !== undefined ? { archived: Boolean(body.archived) } : {}),
  });

  if (!updated) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext<'/api/projects/[id]'>
) {
  const { id } = await params;

  if (!getProject(id)) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Kill any live session in this project first, or its PTY would outlive
  // the project record it points at.
  for (const session of listLiveSessions()) {
    if (session.projectId === id) closeSession(session.id);
  }

  deleteProject(id);
  return NextResponse.json({ ok: true });
}
