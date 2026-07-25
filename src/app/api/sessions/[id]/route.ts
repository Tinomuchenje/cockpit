import { NextRequest, NextResponse } from 'next/server';
import { close as closeSession, restart } from '@/lib/sessionManager';
import { getSession } from '@/lib/db';

/** Restart in place — same tab, fresh `claude`, picks up new MCPs and skills. */
export async function POST(
  _req: NextRequest,
  { params }: RouteContext<'/api/sessions/[id]'>
) {
  const { id } = await params;
  if (!getSession(id)) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!restart(id)) {
    return NextResponse.json(
      { error: 'That session is no longer live, so it cannot be restarted.' },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: RouteContext<'/api/sessions/[id]'>
) {
  const { id } = await params;
  closeSession(id);
  return NextResponse.json({ ok: true });
}
