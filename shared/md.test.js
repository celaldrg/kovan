import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, md } from './md.js';

test('escapes markup before it can run', () => {
  const html = md('<img src=x onerror=alert(1)>');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('onerror'), true);
  assert.match(html, /&lt;img/);
  assert.equal(esc('</script><script>alert(1)</script>').includes('<'), false);
});

test('links are https only and do not keep the opener', () => {
  const blocked = md('[x](javascript:alert(1))');
  assert.equal(blocked.includes('href='), false);
  assert.equal(blocked.includes('javascript:'), true);
  const ok = md('[docs](https://example.com/docs)');
  assert.match(ok, /href="https:\/\/example.com\/docs"/);
  assert.match(ok, /rel="noopener noreferrer"/);
  const quoted = md('[x](https://example.com/"onclick="alert(1))');
  assert.doesNotMatch(quoted, /\sonclick=/);
  assert.match(quoted, /rel="noopener noreferrer"/);
});
