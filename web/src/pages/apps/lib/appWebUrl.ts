import type { AppTemplate } from '@/services/types';

export function getAppWebUrl(app: AppTemplate): string | null {
  if (app.state !== 'running' || !app.web_url) return null;
  const inbound = app.permissions?.network?.inbound;
  if (!inbound || inbound.length === 0) return null;
  const port = inbound[0];
  const path = app.web_url.startsWith('/') ? app.web_url : `/${app.web_url}`;
  // App containers serve plain HTTP on their inbound port (host networking,
  // no TLS). Do NOT mirror the console's protocol here: when the console runs
  // over HTTPS, `window.location.protocol` would be `https:` and the browser
  // would attempt a TLS handshake against an HTTP-only port
  // (ERR_SSL_PROTOCOL_ERROR). The console's HTTPS already protects sensitive
  // flows (login token / terminal PTY / talk audio); app web UIs open in a new
  // top-level tab over HTTP, which is a permitted navigation (not mixed content).
  return `http://${window.location.hostname}:${port}${path}`;
}
