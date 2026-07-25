import { NextRequest, NextResponse } from 'next/server';
import { createCard, getProject, listCards } from '@/lib/db';
import type { ColumnId } from '@/lib/types';

const VALID_COLUMNS: ColumnId[] = ['todo', 'in_progress', 'review', 'done'];

export async function GET() {
  return NextResponse.json(listCards());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const title = body?.title?.trim();
  const projectId = body?.projectId;
  const column = body?.column;

  if (!projectId || !title) {
    return NextResponse.json(
      { error: 'A project and a title are both required.' },
      { status: 400 }
    );
  }
  if (!getProject(projectId)) {
    return NextResponse.json({ error: 'Unknown project.' }, { status: 400 });
  }
  if (column && !VALID_COLUMNS.includes(column)) {
    return NextResponse.json({ error: `Unknown column: ${column}` }, { status: 400 });
  }

  const card = createCard({
    projectId,
    title,
    description: body?.description?.trim() || '',
    column,
  });
  return NextResponse.json(card, { status: 201 });
}
