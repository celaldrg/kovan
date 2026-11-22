import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix, qrSvg } from './qr.js';

test('pairing QR matches the byte-mode matrix for a tunnel URL', () => {
  const text = `https://tunnel.example/phone.html#pair=${'ab'.repeat(32)}`;
  const matrix = qrMatrix(text);
  assert.equal(matrix.length, 41);
  const rows = matrix.map(row => row.map(cell => (cell ? '1' : '0')).join('')).join('\n');
  assert.equal(createHash('sha256').update(rows).digest('hex'), '64fd0f94d612edd97ba2d064f82a69eb107497c9c36da9859b5c6bec5337d37e');
  const svg = qrSvg(text);
  assert.match(svg, /^<svg/);
  assert.equal(svg.includes('<script'), false);
  assert.equal(qrMatrix('c'.repeat(5000)), null);
});
