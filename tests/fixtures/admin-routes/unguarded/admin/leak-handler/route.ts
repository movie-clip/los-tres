// A deliberately unguarded admin route handler: it answers 200 to anyone.
export function GET(): Response {
  return Response.json({ secret: 'admin data' });
}
