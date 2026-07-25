import { NextRequest, NextResponse } from 'next/server';
import { deleteCard, getCard, updateCard } from '@/lib/db';
import { close as closeSession, listLiveSessions } from '@/lib/sessionManager';
import type { ColumnId } from '@/lib/types';

const VALID_COLUMNS: ColumnId[] = ['todo', 'in_progress', 'review', 'done'];

export async function PATCH(
  req: NextRequest,
  { params }: RouteContext<'/api/cards/[id]'>
) {
  const { id } = await params;
  const body = await req.json();

  if (body.column && !VALID_COLUMNS.includes(body.column)) {
    return NextResponse.json({ error: `Unknown column: ${body.column}` }, { status: 400 });
  }
  if (body.title !== undefined && !body.title.trim()) {
    return NextResponse.json({ error: 'A card needs a title.' }, { status: 400 });
  }

  const updated = updateCard(id, {
    ...(body.title !== undefined ? { title: body.title.trim() } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.column !== undefined ? { column: body.column } : {}),
    ...(body.position !== undefined ? { position: body.position } : {}),
  });

  if (!updated) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext<'/api/cards/[id]'>
) {
  const { id } = await params;
  if (!getCard(id)) {
    return NextResponse.json({ error: 'Card not found' }, { status: 404 });
  }

  // Kill the PTY first, or deleting the card would leave a live `claude`
  // running with no card and no tab pointing at it.
  for (const session of listLiveSessions()) {
    if (session.cardId === id) closeSession(session.id);
  }

  deleteCard(id);
  return NextResponse.json({ ok: true });
}
