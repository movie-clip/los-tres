import { handleGo, type GoResult } from '@/server/clicks/handle-go';

// Public route (guardrail 3): anyone may follow a redirect. Which offers
// redirect is decided by the visibility scope inside handleGo (guardrail 1).

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ offer: string }> };

/** Every response of this route is built here, so a header added later goes in one place. */
function respond(result: GoResult): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  switch (result.kind) {
    case 'redirect':
      return new Response(null, { status: 302, headers: { ...headers, Location: result.location } });
    case 'unavailable':
      return new Response(null, { status: 503, headers });
    default:
      return new Response(null, { status: 404, headers });
  }
}

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { offer } = await params;
  const result = await handleGo({
    method: request.method,
    offerParam: offer,
    headers: request.headers,
  });
  return respond(result);
}

export const GET = handle;
export const HEAD = handle;
export const OPTIONS = handle;
