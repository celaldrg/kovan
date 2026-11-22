import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactKeys, redactSecrets } from './redact.js';

test('obvious secret shapes are redacted and ordinary text is kept', () => {
  const anthropic = ['sk', 'ant', 'api03-syntheticfixturekey0000'].join('-');
  const openai = ['sk', 'proj', 'syntheticfixturekey000000'].join('-');
  const google = 'AIza' + 'SyntheticFixtureKey0000000';
  const github = 'ghp_' + 'synthetictokenvalue00000';
  const text = `use ${anthropic} and ${openai} and ${google} and ${github} and Bearer abcdefghijklmnop and api_key=supersecret`;
  const out = redactSecrets(text);
  assert.equal(out.includes(anthropic), false);
  assert.equal(out.includes(openai), false);
  assert.equal(out.includes(google), false);
  assert.equal(out.includes('abcdefghijklmnop'), false);
  assert.equal(out.includes('supersecret'), false);
  assert.match(out, /use \[redacted\]/);
  assert.equal(redactSecrets('fix the greeting'), 'fix the greeting');
  const leaked = redactKeys(`failed with ${anthropic}`, [anthropic]);
  assert.equal(leaked.includes(anthropic), false);
});
