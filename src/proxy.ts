// Next proxy (S11.7, S5.7). Two jobs on every public page.
//
// 1. A page that raises notFound() is served by Next 16 through its error shell:
//    status 404 but an empty body. So a missing product or category URL, or a search
//    page past the last, is rewritten here, before rendering, to an unmatched path;
//    Next then renders the root not-found exactly as it does for any unknown URL.
//    Reads only through the page loaders, so the one visibility scope applies
//    (guardrail 1).
// 2. It forwards the selected car (`?coche=`) to the page as two request headers,
//    `x-car-slug` and `x-car-path`, deleting any copy the client sent
//    (src/server/car/request.ts). Only getCarContext() reads them. The check is the
//    shape of the value; no database is read for the car here.
//
// Logs nothing, sets no cookie and no response header; reads no IP or user agent
// (guardrail 5).

import { NextResponse, type NextRequest } from 'next/server';

import { carRequestHeaders } from '@/server/car/request';
import { isMissingPublicPage } from '@/server/catalogue/missing-page';

// Every public page. Files with a dot (robots.txt, the sitemaps) and /_next, /api, /go
// and /admin stay outside.
export const config = { matcher: ['/((?!_next/|api/|go/|admin|.*\\..*).*)'] };

export async function proxy(request: NextRequest) {
  const headers = carRequestHeaders(request.nextUrl, request.headers);
  try {
    if (await isMissingPublicPage(request.nextUrl)) {
      // `_` folders are private in the app router: no route can ever match this.
      return NextResponse.rewrite(new URL('/_404', request.url), { request: { headers } });
    }
  } catch {
    // A database error: let the page run and fail the way it does today.
  }
  return NextResponse.next({ request: { headers } });
}
