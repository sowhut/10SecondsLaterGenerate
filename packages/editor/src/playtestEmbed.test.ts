import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSandboxUrl } from './playtestEmbed.js';

test('sandbox URL accepts local and hosted HTTP endpoints', () => {
  assert.equal(resolveSandboxUrl('http://127.0.0.1:7456/', 'http://127.0.0.1:5180/')?.origin, 'http://127.0.0.1:7456');
  assert.equal(resolveSandboxUrl('https://play.example.com/sandbox/', 'http://127.0.0.1:5180/')?.origin, 'https://play.example.com');
});

test('sandbox URL rejects empty, malformed, and executable values', () => {
  assert.equal(resolveSandboxUrl('', 'http://127.0.0.1:5180/'), null);
  assert.equal(resolveSandboxUrl('not a url', 'not a base'), null);
  assert.equal(resolveSandboxUrl('javascript:alert(1)', 'http://127.0.0.1:5180/'), null);
});
