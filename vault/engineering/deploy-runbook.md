# Deploy runbook
1. CI green on `main`: unit, integration and contract tests.
2. Deploy to staging; run the smoke suite against the public API.
3. Canary 10% of workspaces for 30 minutes; watch error rate and p95 latency.
4. Full rollout. Roll back if 5xx rate > 0.5% or p95 latency rises by more than 20%.
5. Post the deploy note in #releases with the changelog link.
Reviews before merge follow [[engineering/review-checklist]].
