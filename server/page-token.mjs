// The launch token is injected when a loopback page is served.
// A production build must not copy a token into dist/. A stale meta is replaced.

const TOKEN = /^[a-f0-9]{64}$/i;
const META = /<meta\s+name=["']kovan-token["']\s+content=["'][^"']*["']\s*\/?>/gi;

export function tokenMeta(token) {
  return `<meta name="kovan-token" content="${token}" />`;
}

/** Dev server only. `command: "build"` leaves the HTML untouched. */
export function prepareIndexHtml(html, { command = 'build', token = '' } = {}) {
  if (command !== 'serve') return html;
  if (!TOKEN.test(token)) return html;
  if (html.includes('name="kovan-phone"') || html.includes('name="kovan-token"')) return html;
  const meta = tokenMeta(token);
  return html.includes('<head>') ? html.replace('<head>', `<head>\n  ${meta}`) : `${meta}${html}`;
}

/** Replace any baked token with the token for this launch. Loopback pages only. */
export function injectLaunchToken(html, token) {
  if (html.includes('name="kovan-phone"')) return html.replace(META, '');
  if (!TOKEN.test(token)) return html;
  const meta = tokenMeta(token);
  if (META.test(html)) {
    META.lastIndex = 0;
    return html.replace(META, meta);
  }
  return html.includes('<head>') ? html.replace('<head>', `<head>\n  ${meta}`) : `${meta}${html}`;
}
