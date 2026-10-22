// A guarded admin route handler: an anonymous caller gets an empty 401.
export function GET(): Response {
  return new Response(null, { status: 401 });
}
