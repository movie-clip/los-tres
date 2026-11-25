// Helpers that turn a message-file string into what the page shows, so an e2e
// asserts the copy through messages/es-ES.json and never a literal.

/** Replaces U+00A0 with a plain space (es-ES prices put U+00A0 before the euro sign). */
export function normaliseSpaces(text: string): string {
  return text.replace(/ /g, ' ');
}

/** Renders `{count, plural, one {# x} other {# xs}}` for `count` (only `one` and `other`). */
export function icuPlural(message: string, count: number): string {
  const branch = (name: 'one' | 'other'): string | undefined =>
    new RegExp(`${name}\\s*\\{([^}]*)\\}`).exec(message)?.[1];
  const chosen = (count === 1 ? branch('one') : branch('other')) ?? branch('other');
  if (chosen === undefined) throw new Error('message has no plural branch');
  return chosen.replace(/#/g, String(count));
}

/**
 * A regular expression for a message with one `{date, date, medium}`
 * placeholder, for example "Precio actualizado el 17 oct 2026". The date
 * itself changes per run, so only its shape is pinned.
 */
export function dateMessagePattern(message: string): RegExp {
  const [before, after] = message.split(/\{date, date, medium\}/);
  if (before === undefined || after === undefined) {
    throw new Error('message has no {date, date, medium} placeholder');
  }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escape(before)}\\d{1,2} [\\p{L}]{3,5}\\.? \\d{4}${escape(after)}$`, 'u');
}
