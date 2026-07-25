import { NextRequest, NextResponse } from 'next/server';
import { getCard, getProject, updateCard } from '@/lib/db';
import { listLiveSessions, startSession } from '@/lib/sessionManager';

export async function GET() {
  return NextResponse.json(listLiveSessions());
}

/**
 * Start a terminal session. Either for a card (the normal path — moves it to
 * In Progress) or for a bare project, when you just want a shell somewhere.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { cardId } = body ?? {};
  let projectId = body?.projectId;

  if (cardId) {
    const card = getCard(cardId);
    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    projectId = card.projectId;
  }

  if (!projectId) {
    return NextResponse.json(
      { error: 'A cardId or projectId is required.' },
      { status: 400 }
    );
  }
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Unknown project.' }, { status: 400 });
  }

  let session;
  try {
    session = startSession({
      cardId: cardId ?? null,
      projectId,
      cols: body?.cols,
      rows: body?.rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start session' },
      { status: 500 }
    );
  }

  // Running a card is what moves it out of To Do.
  let card = null;
  if (cardId) {
    card = updateCard(cardId, { column: 'in_progress' });
  }

  return NextResponse.json({ session, card }, { status: 201 });
}
