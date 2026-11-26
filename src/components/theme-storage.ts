// The browser's memory of the visitor's theme choice (#398). Client only: it touches
// `localStorage` and the root element's `data-theme` attribute, and nothing else. No
// server storage, no request, no log, and the only values ever written are
// the two scheme words below (guardrail 5). Every storage access is wrapped: a browser
// that refuses storage, or a throwing one, still changes the scheme for this page view
// and the next load follows the system setting.

/** The one storage key. It names no site: a visitor can read it in devtools. */
export const THEME_STORAGE_KEY = 'tema';

/** The stored word for each scheme. Any other stored value means "follow the system". */
export const STORED_SCHEME = { light: 'claro', dark: 'oscuro' } as const;

export type Scheme = 'light' | 'dark';

/**
 * The blocking script of the root layout's head: it sets `data-theme` on `html` before
 * the body is parsed, so the first paint is already in the right scheme. Admin paths are
 * always dark and read nothing. Otherwise a stored choice wins, then the system setting,
 * then light. It never writes storage and never touches anything but the attribute. A
 * constant string, so a later Content-Security-Policy can allow it by its hash.
 */
export const THEME_SCRIPT =
  '(function(){var d=document.documentElement,s=null,p=location.pathname;' +
  "if(p.split('/')[1]==='admin'){s='dark'}else{" +
  `try{var v=window.localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `if(v==='${STORED_SCHEME.dark}'){s='dark'}else if(v==='${STORED_SCHEME.light}'){s='light'}}catch(e){}` +
  "if(s===null){try{s=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){s='light'}}}" +
  "d.setAttribute('data-theme',s)})();";

const listeners = new Set<() => void>();

/** The scheme on the page now: dark only when the root attribute is exactly `dark`. */
export function currentScheme(): Scheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Applies the scheme to the page, remembers it if storage allows, and tells the listeners. */
export function chooseScheme(next: Scheme): void {
  document.documentElement.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, STORED_SCHEME[next]);
  } catch {
    // Nothing to do: the scheme still changed for this page view.
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` after every `chooseScheme`; returns the unsubscribe. */
export function subscribeScheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
