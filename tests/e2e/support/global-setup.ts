import { request } from '@playwright/test';
import { baseUrl, captchaMode, testPassword } from './env';

/** Fails fast, before any test, when the local copy is not ready or is the wrong kind of target. */
export default async function globalSetup(): Promise<void> {
  testPassword();
  const base = baseUrl();
  const api = await request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  let info: { captcha?: { enabled?: boolean } };
  try {
    const res = await api.get('/api/site');
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    info = await res.json();
  } catch (e) {
    throw new Error(`Cannot reach the local system at ${base}. Start the API (dotnet run --project src/Ccs.Api) and the web app (npm start). ${(e as Error).message}`);
  } finally { await api.dispose(); }
  const on = !!info.captcha?.enabled;
  if (captchaMode === 'off' && on)
    throw new Error('The captcha is switched ON in this local copy, so automatic sign-in is blocked. Switch it off in the LOCAL database copy for the run (Settings, captcha), or run "npm run test:captcha" for the captcha check only.');
  if (captchaMode === 'on' && !on)
    throw new Error('CCS_CAPTCHA=on but the captcha is switched off in this local copy. Switch it on first.');
}
