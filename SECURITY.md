# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.3.0 | Yes |
| 0.2.0 | Yes |
| 0.1.1 and older | No |

0.1.0 listens on every interface and does not authenticate the API. 0.1.1 is the loopback release without budgets or phone pairing. 0.2.0 adds budgets and phone pairing. 0.3.0 adds more CLIs, providers, and a local replay store.

## Reporting a vulnerability

Report security issues through GitHub private vulnerability reporting:

https://github.com/celaldrg/kovan/security/advisories/new

Please do not open a public issue for a vulnerability, and do not include exploit details in a public commit or pull request.

This project has no security email address. Use the private reporting page above.

## What 0.3.0 stores

Replay writes a timeline under the data directory (`data/replay/*.jsonl`, or `$KOVAN_DATA/replay`). Each file is mode `0600`. The directory is mode `0700` where the platform allows it. Lines are prompts, tool calls, approvals and cost notes from sessions Kovan is already showing.

Before a line is written, Kovan redacts home-directory prefixes and obvious secret shapes (API key prefixes, bearer tokens, `api_key=` / `token=` / `password=` assignments). This is a pattern pass. It will miss a secret that does not look like those shapes. Do not point Kovan at a transcript you cannot store on this machine.

Set `KOVAN_REPLAY=0` or `"replay": { "enabled": false }` to stop recording. `replay.retentionDays` (or `KOVAN_REPLAY_DAYS`) drops older lines on startup. The default is 30 days.

Provider keys are read from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` at call time. Kovan does not write those values into config, the data directory, or the text returned when a call fails. Ollama is called at `OLLAMA_HOST`, which must be loopback unless `KOVAN_OLLAMA_ALLOW_REMOTE=1`.

OpenCode's service file can contain a password. Kovan reads it to call `127.0.0.1` only, sends it as a Basic header, and does not copy it into the replay store. A non-loopback service URL is ignored.

Codex and Gemini hooks use the same forwarder as Claude Code. If Kovan is down, the token is missing, or the wait ends, the process exits 0 and prints nothing. That is not an allow. Codex is not sent `updatedPermissions` on `PermissionRequest`, because that field fails closed. Gemini `BeforeTool` is allowed only when you choose Allow. Aider has no approval hook, so those sessions stay read-only.

## Threat model

Kovan is a local dashboard. It can show Claude Code sessions and answer permission prompts, including shell commands. The person at the keyboard is trusted. Other users on the machine, other devices on the network, and websites the browser loads are not.

What 0.2.0 keeps from 0.1.1, and what it adds:

- Binds `127.0.0.1` unless `KOVAN_HOST` is set. A non-loopback bind prints a warning. `KOVAN_HOST_ALLOW` is the list of extra `Host` names that may call the API. `0.0.0.0` is not itself an allowed `Host`.
- Writes a new 32-byte token to a mode `0600` file on each launch and requires the header `x-kovan-token` on `/api/*`, including `/api/hooks`. The exception is the phone routes, and only when `KOVAN_PHONE=1`: pairing, the pending list, push subscription, and a single approval use the paired device credential (`x-kovan-device`) or a one-time pairing code, not the launch token.
- Installed hooks are command hooks. `bin/hook-forward.mjs` reads the token file and posts only to a loopback `/api/hooks` URL. If the token is missing, the server is down, or the wait ends, the process exits 0 and prints nothing. That is not an allow.
- Checks `Host` on every request. For any request that is not `GET` or `HEAD`, requires `Content-Type: application/json` and, when `Origin` is present, requires it to be this server's own `http://<allowed-host>:<port>`. If phone access is on, that `Origin` may instead be the exact `KOVAN_PUBLIC_ORIGIN`, including when that origin is `https`. No `Access-Control-Allow-Origin` header is sent.
- Allowlists model, effort, department, and schedule-rule fields before they are stored. The Claude CLI is started without a shell. The model is a single `--model=<id>` argument. The prompt is written to stdin.
- Escapes text the web UI inserts as HTML, and sets a Content-Security-Policy that allows scripts only from the app's own files. Inline styles remain allowed because zone colors are style attributes.
- Returns `413` for a body over the limit. Unexpected errors return `request failed`. The server log keeps the detail.
- Writes Claude settings and the Kovan backup as mode `0600`.
- Prices reported token usage and can stop company-mode jobs, or deny a live permission request, when a budget is spent. The denial is explicit. It is not an allow, and a missing price is not treated as zero in order to keep going.
- Phone access is off unless `KOVAN_PHONE=1`. The phone page does not receive the launch token. The desktop page receives that token only for a loopback `Host`. A paired phone authenticates with its own credential, stored as a hash and revocable from the desktop. Pairing codes expire after 5 minutes and work once. Each approval token is single-use, bound to one request, and expires after 5 minutes. Push delivery uses a VAPID key generated on the machine (mode `0600`). There is no third-party push account. A failed push, an expired token, a revoked device, or a request that has already closed does not allow the tool.

Hooks from 0.1.0 do not send the token. Run `node bin/kovan.mjs hooks install` again after upgrading. Install and uninstall still leave hooks that are not Kovan's.

### Reaching Kovan from a phone

Leave the bind on `127.0.0.1` and run your own tunnel (Tailscale, SSH, or another forwarder you operate) to that port. Set `KOVAN_PUBLIC_ORIGIN` to the exact `http` or `https` origin the phone will open. Kovan then accepts that origin and that hostname, and no others.

Or set `KOVAN_HOST` to an address on a LAN you trust, set `KOVAN_PUBLIC_ORIGIN` to the URL the phone will use, and set `KOVAN_HOST_ALLOW` if the browser will send a different name. A non-loopback bind still prints a warning. The launch token and the device credential are still required. Kovan does not open a tunnel or a public relay by itself.

## Known limits

Company-mode jobs still decide "needs approval" with a keyword check. A task that is not phrased like the keywords can run with the tools the existing company-mode call already enabled. This release does not turn that into a new policy engine. Claude Code permission prompts are a separate path and are never auto-allowed.

There is no per-minute cap on how many company jobs can be queued. Spend limits are the budgets you configure. The body-size limit is what stops an oversized request from sitting open.

`KOVAN_HOST` other than loopback is an explicit choice. Do that only on a network you trust, and set `KOVAN_HOST_ALLOW` to the names you will actually use. The token is still required.

Dev-only dependencies used by the screenshot script are not part of `npm install --omit=dev`. This release does not bump them.
