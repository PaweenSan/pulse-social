import test from 'node:test'
import assert from 'node:assert/strict'
import { initials, relativeTime, safeWebsite } from './utils.js'
test('public profile links reject script protocols and display values handle edge cases', () => {
  assert.equal(safeWebsite('javascript:alert(1)'), '')
  assert.equal(safeWebsite('https://example.com'), 'https://example.com/')
  assert.equal(safeWebsite('not a URL'), '')
  assert.equal(initials('  Jane Doe  '), 'JD')
  assert.equal(initials(''), '?')
  assert.equal(relativeTime('bad'), '')
  assert.equal(relativeTime('2026-01-01T00:00:00Z', Date.parse('2026-01-01T01:00:00Z')), '1h ago')
})
