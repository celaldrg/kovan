# Pull-request review checklist
- Does the change have a test that fails without it?
- API changes: versioned, documented, backwards compatible for one release.
- No secrets, tokens or customer data in code, logs or fixtures.
- Migrations are reversible and safe on large tables.
- Observability: new endpoints emit latency and error metrics.
