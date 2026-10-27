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

test('photo upload bounds and backend-only image URLs reject unsafe sources', async () => {
  const { validatePhotoFile, photoDimensions, postImageUrl } = await import('./utils.js')
  assert.throws(() => validatePhotoFile({ type: 'image/svg+xml', size: 400 }), /JPG, PNG, or WebP/)
  assert.throws(() => validatePhotoFile({ type: 'image/jpeg', size: 11 * 1024 * 1024 }), /under 10 MB/)
  assert.throws(() => validatePhotoFile({ type: 'image/png', size: 0 }), /empty/)
  assert.doesNotThrow(() => validatePhotoFile({ type: 'image/jpeg', size: 1024 }))
  assert.deepEqual(photoDimensions(8000, 6000), { width: 1600, height: 1200 })
  assert.deepEqual(photoDimensions(6000, 8000), { width: 1200, height: 1600 })
  assert.deepEqual(photoDimensions(400, 300), { width: 400, height: 300 })
  assert.throws(() => photoDimensions(12000, 12000), /smaller photo/)
  assert.throws(() => photoDimensions(0, 400), /smaller photo/)
  const base = 'https://backend.example/api'
  assert.equal(postImageUrl('/api/posts/ab12-34/image', base), 'https://backend.example/api/posts/ab12-34/image')
  for (const value of ['https://evil.example/api/posts/ab12/image', '//evil.example/api/posts/ab12/image', 'data:image/svg+xml,abc', 'javascript:alert(1)', '/api/auth/me', '/api/posts/a/image?secret=1', '/api/posts/a/image#fragment', 'https://user:pass@backend.example/api/posts/a/image']) assert.equal(postImageUrl(value, base), '', value)
})
