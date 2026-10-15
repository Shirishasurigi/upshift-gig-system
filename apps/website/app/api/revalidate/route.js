import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request) {
  const expectedSecret = process.env.REVALIDATE_SECRET;
  const suppliedSecret = request.headers.get('x-revalidate-secret');

  // Fail closed if the shared secret has not been configured.
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const requestedPaths = Array.isArray(body?.paths) ? body.paths : [];
  const paths = requestedPaths.filter(
    (value) => typeof value === 'string' &&
      (value === '/opportunities' || /^\/opportunities\/\d+$/.test(value))
  );

  if (paths.length === 0) {
    return NextResponse.json({ error: 'No valid paths supplied' }, { status: 400 });
  }

  for (const path of new Set(paths)) revalidatePath(path);
  return NextResponse.json({ revalidated: true, paths: [...new Set(paths)] });
}
