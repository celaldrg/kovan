# Changelog

All notable changes to this project are documented here. The format is based on Keep a Changelog, and this project uses semantic versioning.

## [0.3.0] - 2026-11-22

### Added

- Live sessions from Codex, Gemini CLI, OpenCode and Aider next to Claude Code. Each adapter is optional and stays quiet when the tool is absent.
- Codex and Gemini CLI hooks, installed only when that tool's config directory already exists. A hook that exits without a decision does not allow the tool. Codex `PermissionRequest` replies omit `updatedPermissions`, which that event rejects. Gemini `BeforeTool` can deny, or allow once. Aider is read-only: it records chat history and can notify when a reply is ready, and it has no approval hook. OpenCode approvals are sent only to its loopback service, and only after Allow or Deny.
- Company-mode runs can use OpenAI, Gemini or local Ollama in addition to Claude. Model ids stay on the configured allowlist. Ollama defaults to loopback and is priced at 0. Keys are read from the environment and are not written to the repo or to error text.
- A local session timeline under the data directory: prompts, tool calls, approvals and cost. Files are mode 0600. Recording can be turned off. Retention is configurable. Search filters by CLI, project, date and status. Obvious secrets are redacted before a line is stored.
- The rate card adds published OpenAI and Gemini text prices, dated 2026-11-22. Ollama is 0.

## [0.2.0] - 2026-11-22

### Added

- Live cost for a session, a project, and a department, from token usage Claude Code reports in hooks or session JSONL and from company-mode runs. The rate card is dated and can be overridden. Missing usage is not filled in.
- Budgets per scope. Warnings at 75% and 95%. At the limit, company-mode work stops, and a live permission request is denied instead of left open or allowed.
- A runaway flag for a repeated tool call, a tool-call spike, or a short cost spike.
- An installable phone page: pairing QR, a revocable device credential, single-use approval tokens that expire after 5 minutes, and Web Push with a VAPID key generated on the machine. Phone access is off until `KOVAN_PHONE=1`. The launch token stays on loopback.

### Security

- Phone routes still require the Host and Origin checks. The phone does not receive the launch token. A failed push or an expired token is not an allow.

## [0.1.1] - 2026-11-22

### Security

- Bind `127.0.0.1` unless `KOVAN_HOST` is set, and warn when the bind is not loopback.
- Require a per-launch token, stored mode `0600`, on every `/api/*` request. Installed hooks read that file and send it. They still exit without allowing anything when Kovan is down.
- Reject unexpected `Host` and `Origin` values, accept JSON bodies only, and do not send a CORS allow header.
- Allowlist model, effort, department, and schedule rules. Pass `--model=<id>` as one CLI argument. Escape those values in the UI and send a Content-Security-Policy.
- Return `413` for an oversized body instead of leaving the request open.
- Return a generic error to the client. Keep the detail in the server log.
- Keep static files inside `dist/` using a root check that rejects a sibling directory.
- Write Claude `settings.json` and the Kovan backup as mode `0600`.

### Changed

- Document running from a clone (`node bin/kovan.mjs hooks install`) instead of `npx kovan`. The npm name is not this project's.
- Version is 0.1.1. `package.json` lists the files a pack would include. Nothing was published.

## [0.1.0] - 2026-11-21

### Added

- Live hive for Claude Code sessions, with permission cards and a demo mode.
- Company mode: departments, routines, the board, the calendar, and the vault.
