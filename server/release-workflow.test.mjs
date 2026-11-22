import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('publish workflows are manual or release-only and do not run on a pull request', () => {
  const release = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.equal(/^\s*pull_request:/m.test(release), false);
  assert.equal(/^\s*push:/m.test(release), false);
  assert.match(release, /types:\s*\[published\]/);
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /secrets\.NPM_TOKEN/);
  assert.match(release, /secrets\.GITHUB_TOKEN/);
  assert.match(release, /ghcr\.io\/celaldrg\/kovan/);
  assert.equal(/npm_[A-Za-z0-9]{10,}/.test(release), false);
  assert.equal(ci.includes('npm publish'), false);
  assert.equal(ci.includes('docker push'), false);
  assert.equal(ci.includes('gh release upload'), false);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, '@celaldrg/kovan');
  assert.equal(pkg.bin.kovan, './bin/kovan.mjs');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.version, '0.4.0');
});
