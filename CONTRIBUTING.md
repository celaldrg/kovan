# Contributing

Thanks for looking at Kovan. This document is how to set up, test, and send a change.

## Setup

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/celaldrg/kovan.git
cd kovan
npm install
npm test
npm run build
npm run demo
```

`npm start` builds the web app if `dist/` is missing, then serves http://127.0.0.1:4700 .

Attach hooks from the clone, not from the npm registry:

```bash
node bin/kovan.mjs hooks install
node bin/kovan.mjs hooks uninstall
```

The npm package is `@celaldrg/kovan`. The bin name is `kovan`. `npm start` and `node bin/kovan.mjs` start the server from a clone. Publishing is the release workflow, not a pull request.

## Tests

`npm test` runs the node test runner. Add tests next to the code (`server/*.test.mjs`, `shared/*.test.js`). Cover a security change with a failing case: missing token, bad `Host`, bad `Origin`, non-JSON body, oversized body, and a model or rule that is not on the allowlist.

`npm run build` type-checks the web app and produces `dist/`.

## Commits

Use a short imperative subject, then a blank line and the reason if it is not obvious. Example: `Require a per-launch token on the API`.

This project does not use a CLA. By sending a contribution you agree it is licensed under the MIT license in `LICENSE`. A `Signed-off-by` line is welcome and not required.

## Secrets and personal data

Do not commit tokens, `.env` files, `data/`, local settings, machine paths, or personal information. `.env.example` holds empty placeholders only.

## Security reports

Use GitHub private vulnerability reporting, not a public issue: https://github.com/celaldrg/kovan/security/advisories/new

See `SECURITY.md`.
