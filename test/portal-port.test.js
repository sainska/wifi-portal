const test = require('node:test');
const assert = require('node:assert/strict');

const { getHttpPortCandidates } = require('../src/config');

test('getHttpPortCandidates prefers the requested port and falls back to common alternatives', () => {
  assert.deepEqual(getHttpPortCandidates(80), [80, 8080, 8000]);
  assert.deepEqual(getHttpPortCandidates(8080), [8080, 8000, 80]);
  assert.deepEqual(getHttpPortCandidates(9000), [9000, 8080, 8000, 80]);
});
