import { NextResponse, type NextRequest } from 'next/server';

// A quick redirect for people with no session at all. It is not the security boundary: every
// admin page and every Server Action checks the operator again against the database.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('session')) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = { matcher: '/admin/:path*' };
