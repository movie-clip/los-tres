// Next proxy (S11.7). A page that raises notFound() is served by Next 16 through
// its error shell: status 404 but an empty body. So a missing product or
// category URL, or a search page past the last, is rewritten here, before
// rendering, to an unmatched path; Next
// then renders the root not-found exactly as it does for any unknown URL.
//
// Reads only through the page loaders, so the one visibility scope applies
// (guardrail 1). Logs nothing and sets no cookie or header; reads no IP or user
// agent (guardrail 5).

import { NextResponse, type NextRequest } from 'next/server';

import { isMissingPublicPage } from '@/server/catalogue/missing-page';

export const config = { matcher: ['/producto/:slug', '/categoria/:slug', '/buscar'] };

export async function proxy(request: NextRequest) {
  try {
    if (await isMissingPublicPage(request.nextUrl)) {
      // `_` folders are private in the app router: no route can ever match this.
      return NextResponse.rewrite(new URL('/_404', request.url));
    }
  } catch {
    // A database error: let the page run and fail the way it does today.
  }
  return NextResponse.next();
}
