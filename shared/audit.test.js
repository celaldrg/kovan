import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditHash, filterAudit, sealAudit, verifyChain } from './audit.js';

function line(partial, prev) {
  return sealAudit({
    seq: partial.seq,
    at: partial.at,
    actor: partial.actor,
    decision: partial.decision,
    behavior: partial.behavior || '',
    ruleId: partial.ruleId || null,
    rulesStatus: partial.rulesStatus || 'ok',
    cli: partial.cli || 'claude',
    project: partial.project || 'lighthouse-api',
    sessionId: partial.sessionId || 'ses_lighthouse',
    tool: partial.tool || 'Bash',
    command: partial.command || 'npm test',
    path: partial.path || '',
    costSoFar: partial.costSoFar ?? null,
    reason: partial.reason || '',
    prev,
  });
}

function chain() {
  const first = line({ seq: 1, at: 10, actor: 'rule', decision: 'deny', behavior: 'deny', ruleId: 'deny-rm' }, '');
  const second = line({ seq: 2, at: 20, actor: 'desktop', decision: 'allow', behavior: 'allow' }, first.hash);
  const third = line({ seq: 3, at: 30, actor: 'phone', decision: 'deny', behavior: 'deny' }, second.hash);
  return [first, second, third];
}

test('a valid chain verifies and an edited line does not', () => {
  const rows = chain();
  const head = { hash: rows[2].hash, seq: 3, count: 3 };
  assert.equal(verifyChain(rows, head).ok, true);
  const edited = structuredClone(rows);
  edited[1].command = 'npm test --watch';
  const broken = verifyChain(edited, head);
  assert.equal(broken.ok, false);
  assert.equal(broken.error, 'hash mismatch');
  assert.equal(broken.seq, 2);
  const relinked = structuredClone(rows);
  relinked[1].command = 'npm test --watch';
  relinked[1].hash = auditHash(relinked[1]);
  assert.equal(verifyChain(relinked, head).error, 'chain break');
});

test('dropping a middle record breaks the chain', () => {
  const rows = chain();
  const head = { hash: rows[2].hash, seq: 3, count: 3 };
  assert.equal(verifyChain([rows[0], rows[2]], { hash: rows[2].hash, seq: 3, count: 2 }).ok, false);
  assert.equal(verifyChain(rows, { hash: rows[1].hash, seq: 2, count: 2 }).error, 'head mismatch');
  assert.equal(verifyChain([], null).ok, true);
  assert.equal(verifyChain(rows, null).error, 'head mismatch');
});

test('export filtering keeps records since a timestamp', () => {
  const rows = chain();
  assert.equal(filterAudit(rows, { since: 20 }).length, 2);
  assert.equal(filterAudit(rows, { since: '1970-01-01T00:00:00.020Z', actor: 'phone' }).length, 1);
  assert.equal(filterAudit(rows, { decision: 'allow', cli: 'claude' })[0].seq, 2);
  assert.equal(filterAudit(rows, { q: 'missing' }).length, 0);
});
