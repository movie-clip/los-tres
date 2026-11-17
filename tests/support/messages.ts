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
 * Renders a message with one top-level `{count, plural, one {...} other {...}}` and plain `{name}`
 * placeholders, where a branch may itself hold `{name}` (`icuPlural` stops at the first closing brace,
 * so it cannot read those). `vars.count` picks the branch and fills `#`.
 */
export function renderMessage(message: string, vars: Record<string, string | number>): string {
  const head = /\{count,\s*plural,\s*/.exec(message);
  let text = message;
  if (head !== null) {
    const branches = new Map<string, string>();
    let index = head.index + head[0].length;
    let end = -1;
    while (index < message.length) {
      const next = /^\s*(\w+)\s*\{/.exec(message.slice(index));
      if (next === null) {
        end = message.indexOf('}', index);
        break;
      }
      let depth = 1;
      let cursor = index + next[0].length;
      const start = cursor;
      while (depth > 0) {
        const ch = message[cursor++];
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      branches.set(next[1], message.slice(start, cursor - 1));
      index = cursor;
    }
    const count = Number(vars.count);
    const chosen = (count === 1 ? branches.get('one') : undefined) ?? branches.get('other');
    if (chosen === undefined || end === -1) throw new Error('message has no plural branch');
    text = message.slice(0, head.index) + chosen.replace(/#/g, String(count)) + message.slice(end + 1);
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
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
