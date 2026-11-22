# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.1 | Yes |
| 0.1.0 | No |

0.1.0 listens on every interface and does not authenticate the API. Upgrade to 0.1.1.

## Reporting a vulnerability

Report security issues through GitHub private vulnerability reporting:

https://github.com/celaldrg/kovan/security/advisories/new

Please do not open a public issue for a vulnerability, and do not include exploit details in a public commit or pull request.

This project has no security email address. Use the private reporting page above.

## Threat model

Kovan is a local dashboard. It can show Claude Code sessions and answer permission prompts, including shell commands. The person at the keyboard is trusted. Other users on the machine, other devices on the network, and websites the browser loads are not.

What 0.1.1 does:

- Binds `127.0.0.1` unless `KOVAN_HOST` is set. A non-loopback bind prints a warning. `KOVAN_HOST_ALLOW` is the list of extra `Host` names that may call the API. `0.0.0.0` is not itself an allowed `Host`.
- Writes a new 32-byte token to a mode `0600` file on each launch and requires the header `x-kovan-token` on every `/api/*` route, including `/api/hooks`.
- Installed hooks are command hooks. `bin/hook-forward.mjs` reads the token file and posts only to a loopback `/api/hooks` URL. If the token is missing, the server is down, or the wait ends, the process exits 0 and prints nothing. That is not an allow.
- Checks `Host` on every request. For any request that is not `GET` or `HEAD`, requires `Content-Type: application/json` and, when `Origin` is present, requires it to be this server's own `http://<allowed-host>:<port>`. No `Access-Control-Allow-Origin` header is sent.
- Allowlists model, effort, department, and schedule-rule fields before they are stored. The Claude CLI is started without a shell. The model is a single `--model=<id>` argument. The prompt is written to stdin.
- Escapes text the web UI inserts as HTML, and sets a Content-Security-Policy that allows scripts only from the app's own files. Inline styles remain allowed because zone colors are style attributes.
- Returns `413` for a body over the limit. Unexpected errors return `request failed`. The server log keeps the detail.
- Writes Claude settings and the Kovan backup as mode `0600`.

Hooks from 0.1.0 do not send the token. Run `node bin/kovan.mjs hooks install` again after upgrading. Install and uninstall still leave hooks that are not Kovan's.

## Known limits

Company-mode jobs still decide "needs approval" with a keyword check. A task that is not phrased like the keywords can run with the tools the existing company-mode call already enabled. This release does not turn that into a new policy engine. Claude Code permission prompts are a separate path and are never auto-allowed.

There is no per-minute job cap and no spend budget in this release. The body-size limit is what stops an oversized request from sitting open.

`KOVAN_HOST` other than loopback is an explicit choice. Do that only on a network you trust, and set `KOVAN_HOST_ALLOW` to the names you will actually use. The token is still required.

Dev-only dependencies used by the screenshot script are not part of `npm install --omit=dev`. This release does not bump them.
