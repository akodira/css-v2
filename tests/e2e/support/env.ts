/** Settings read from the environment. Nothing secret is stored in any file of this repo. */
import * as fs from 'node:fs';
import * as path from 'node:path';

// Tiny .env reader (no extra package): KEY=value lines, comments with #.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Safety guard: these tests create tickets and change accounts, so they run only against a local copy.
 * Any other address (for example the public site) is refused unless CCS_ALLOW_REMOTE=yes is set on purpose.
 */
export function baseUrl(): string {
  const raw = (process.env.CCS_BASE_URL || 'http://localhost:4200').replace(/\/+$/, '');
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.CCS_ALLOW_REMOTE !== 'yes') {
    throw new Error(
      `Refusing to run against ${host}. These tests change data, so they run on the LOCAL copy only ` +
      `(CCS_BASE_URL=http://localhost:4200). Set CCS_ALLOW_REMOTE=yes only for a staging copy that is not production.`);
  }
  return raw;
}

export function testPassword(): string {
  const p = process.env.CCS_TEST_PASSWORD;
  if (!p) throw new Error('CCS_TEST_PASSWORD is not set. Put it in tests/e2e/.env (not committed) or set it in the terminal.');
  return p;
}

/** CCS_CAPTCHA=on runs the captcha check only; the default run needs the captcha switched off in the local copy. */
export const captchaMode = (process.env.CCS_CAPTCHA || 'off').toLowerCase() === 'on' ? 'on' : 'off';
