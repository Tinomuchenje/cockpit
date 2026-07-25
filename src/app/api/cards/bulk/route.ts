import { NextRequest, NextResponse } from 'next/server';
import { deleteCard, listCards } from '@/lib/db';
import { close as closeSession, listLiveSessions } from '@/lib/sessionManager';
import type { ColumnId } from '@/lib/types';

const VALID_COLUMNS: ColumnId[] = ['todo', 'in_progress', 'review', 'done'];

/**
 * Delete many cards at once — used to clear out Done, which otherwise grows
 * without limit. One request instead of N, so clearing 200 cards doesn't mean
 * 200 round trips.
 *
 * Accepts either an explicit list of ids, or a whole column.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ids, column } = body ?? {};

  let targets: string[];

  if (Array.isArray(ids)) {
    targets = ids;
  } else if (column) {
    if (!VALID_COLUMNS.includes(column)) {
      return NextResponse.json({ error: `Unknown column: ${column}` }, { status: 400 });
    }
    targets = listCards()
      .filter((c) => c.column === column)
      .map((c) => c.id);
  } else {
    return NextResponse.json(
      { error: 'Provide either ids or a column to clear.' },
      { status: 400 }
    );
  }

  // Kill any live PTY belonging to these cards before their rows go, so we
  // don't leave `claude` running with nothing pointing at it.
  const doomed = new Set(targets);
  for (const session of listLiveSessions()) {
    if (session.cardId && doomed.has(session.cardId)) closeSession(session.id);
  }

  let deleted = 0;
  for (const id of targets) {
    if (deleteCard(id)) deleted++;
  }

  return NextResponse.json({ deleted, ids: targets });
}
