import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildId } from './buildIdentity.mjs';

test('explicit build ID overrides deployment and CI commit IDs', () => {
  assert.equal(
    resolveBuildId({ VITE_BUILD_ID: 'release-a', COMMIT_REF: 'netlify', GITHUB_SHA: 'ci' }),
    'release-a',
  );
  assert.equal(resolveBuildId({ COMMIT_REF: 'netlify', GITHUB_SHA: 'ci' }), 'netlify');
  assert.equal(resolveBuildId({ GITHUB_SHA: 'ci' }), 'ci');
});

test('local builds identify the checked-out commit', () => {
  assert.match(resolveBuildId({}), /^[a-f0-9]{40,64}$/);
});
