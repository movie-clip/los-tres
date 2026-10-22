// Reads the email and the password for create-admin from stdin, never from the
// command line (AC 3). On a terminal it prompts, echoing the email and hiding the
// password. Piped (tests, `docker compose run -T`), line 1 is the email and line
// 2 the password; only the trailing line break is removed from each.

export type Credentials = { email: string; password: string };

/** Splits piped input into the two lines. A missing line is the empty string. */
export function parseCredentialLines(input: string): Credentials {
  const lines = input.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  return { email: lines[0] ?? '', password: lines[1] ?? '' };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads one line from a terminal in raw mode; `echo` false shows nothing as the user types. */
function promptLine(prompt: string, echo: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const finish = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new Error('interrupted'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (echo) process.stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        if (echo) process.stdout.write(char);
      }
    };
    input.on('data', onData);
  });
}

/** Email and password from a terminal (prompted) or from piped stdin (two lines). */
export async function readCredentials(): Promise<Credentials> {
  if (process.stdin.isTTY) {
    const email = await promptLine('Email: ', true);
    const password = await promptLine('Password: ', false);
    return { email, password };
  }
  return parseCredentialLines(await readAllStdin());
}
