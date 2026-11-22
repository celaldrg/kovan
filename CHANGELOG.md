# Changelog

All notable changes to this project are documented here. The format is based on Keep a Changelog, and this project uses semantic versioning.

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
