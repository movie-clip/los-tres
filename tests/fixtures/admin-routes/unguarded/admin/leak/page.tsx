import { createElement } from 'react';

// A deliberately unguarded admin page: it never asks who is calling. The AC 22
// enumerator must report it. Not part of the app; read only by admin-routes.test.ts.
export default function LeakyPage() {
  return createElement('main', null, 'admin secrets');
}
