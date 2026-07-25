import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { createProject, findProjectByPath, listProjects } from '@/lib/db';

export async function GET() {
  return NextResponse.json(listProjects());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const displayName = body?.displayName?.trim();
  const rawPath = body?.folderPath?.trim();
  const stack = body?.stack?.trim() || null;

  if (!displayName || !rawPath) {
    return NextResponse.json(
      { error: 'A display name and folder path are both required.' },
      { status: 400 }
    );
  }

  // Normalise so C:/foo, C:\foo and C:\foo\ are recognised as the same project.
  const folderPath = path.resolve(rawPath);

  if (!fs.existsSync(folderPath)) {
    return NextResponse.json(
      { error: `That folder doesn't exist: ${folderPath}` },
      { status: 400 }
    );
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    return NextResponse.json(
      { error: `That path is a file, not a folder: ${folderPath}` },
      { status: 400 }
    );
  }
  if (findProjectByPath(folderPath)) {
    return NextResponse.json(
      { error: 'That folder is already added as a project.' },
      { status: 409 }
    );
  }

  const isGitRepo = fs.existsSync(path.join(folderPath, '.git'));

  const project = createProject({ displayName, folderPath, stack });
  // Not a git repo isn't fatal — you just won't be able to commit from here.
  return NextResponse.json({ ...project, isGitRepo }, { status: 201 });
}
