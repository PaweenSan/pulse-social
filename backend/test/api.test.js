import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { eq, sql } from 'drizzle-orm';
import { connectDatabase } from '../src/db.js';
import { migrateDatabase } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { sessions, users, posts, comments, likes, rateLimits } from '../src/schema.js';
import { hashToken } from '../src/auth.js';

test('Pulse API: complete social flow and trust boundaries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-api-'));
  const { client, db } = connectDatabase({ TURSO_DATABASE_URL: `file:${join(dir, 'test.db')}` });
  await migrateDatabase(db);
  const server = createApp({ db, env: { FRONTEND_URL: 'http://localhost:5173' } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); client.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { method = 'GET', token, body, origin } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }), ...(origin && { Origin: origin }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  const account = (username, email = `${username}@example.com`) => ({ name: username, username, email, password: 'correct-horse-42' });
  let alice, bob, post, comment;
  await t.test('registration, duplicate rejection, login, token secrecy', async () => {
    alice = await request('/auth/register', { method: 'POST', body: account('alice') });
    assert.equal(alice.status, 201);
    assert.equal(alice.data.user.username, 'alice');
    assert.equal('passwordHash' in alice.data.user, false);
    assert.equal('email' in alice.data.user, false);
    assert.equal((await request('/auth/register', { method: 'POST', body: account('alice') })).status, 409);
    bob = await request('/auth/register', { method: 'POST', body: account('bob') });
    assert.equal(bob.status, 201);
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'wrong-pass' } })).status, 401);
    const login = await request('/auth/login', { method: 'POST', body: account('alice') });
    assert.equal(login.status, 200);
    assert.equal((await request('/auth/me', { token: login.data.token })).data.user.id, alice.data.user.id);
    const stored = await db.select().from(sessions);
    assert.equal(stored.some(session => session.tokenHash === alice.data.token), false);
    assert.equal(stored.some(session => session.tokenHash === hashToken(alice.data.token)), true);
    const [savedUser] = await db.select().from(users).where(eq(users.id, alice.data.user.id));
    assert.notEqual(savedUser.passwordHash, account('alice').password);
    assert.equal(savedUser.passwordHash.split(':')[1].length, 128);
  });
  await t.test('profile validation and public profile shape', async () => {
    assert.equal((await request('/me', { method: 'PATCH', token: alice.data.token, body: { website: 'javascript:alert(1)' } })).status, 400);
    const update = await request('/me', { method: 'PATCH', token: alice.data.token, body: { name: 'Alice Artist', bio: 'Building little things.', website: 'https://example.com' } });
    assert.equal(update.status, 200);
    assert.equal(update.data.user.bio, 'Building little things.');
    assert.equal((await request('/users/alice')).data.user.name, 'Alice Artist');
    assert.equal((await request('/me', { method: 'PATCH', token: alice.data.token, body: { email: 'bad@example.com' } })).status, 400);
  });
  await t.test('post create/read/edit, ownership, plain content, search escapes', async () => {
    assert.equal((await request('/posts', { method: 'POST', body: { content: 'No access' } })).status, 401);
    assert.equal((await request('/posts', { method: 'POST', token: alice.data.token, body: { content: ' ' } })).status, 400);
    post = await request('/posts', { method: 'POST', token: alice.data.token, body: { content: 'Hello 100% _pulse_ <script>alert(1)</script>' } });
    assert.equal(post.status, 201);
    assert.equal(post.data.post.author.name, 'Alice Artist');
    assert.equal(post.data.post.liked, false);
    assert.equal((await request(`/posts/${post.data.post.id}`, { method: 'PATCH', token: bob.data.token, body: { content: 'hijack' } })).status, 403);
    assert.equal((await request(`/posts/${post.data.post.id}`, { method: 'DELETE', token: bob.data.token })).status, 403);
    assert.equal((await request('/posts?q=%25')).data.posts.length, 1);
    assert.equal((await request('/posts?q=not-found')).data.posts.length, 0);
    assert.equal((await request('/posts?cursor=invalid')).status, 400);
    const edited = await request(`/posts/${post.data.post.id}`, { method: 'PATCH', token: alice.data.token, body: { content: 'Edited 100% _pulse_' } });
    assert.equal(edited.data.post.content, 'Edited 100% _pulse_');
  });
  await t.test('likes are idempotent and viewer-specific', async () => {
    const path = `/posts/${post.data.post.id}/like`;
    assert.deepEqual((await request(path, { method: 'PUT', token: bob.data.token })).data, { liked: true, likeCount: 1 });
    assert.equal((await request(path, { method: 'PUT', token: bob.data.token })).data.likeCount, 1);
    assert.equal((await request('/posts', { token: bob.data.token })).data.posts[0].liked, true);
    assert.equal((await request('/posts', { token: alice.data.token })).data.posts[0].liked, false);
    assert.deepEqual((await request(path, { method: 'DELETE', token: bob.data.token })).data, { liked: false, likeCount: 0 });
  });
  await t.test('comments validation, author checks, and cascades', async () => {
    const path = `/posts/${post.data.post.id}/comments`;
    assert.equal((await request(path, { method: 'POST', token: bob.data.token, body: { content: 'x'.repeat(501) } })).status, 400);
    comment = await request(path, { method: 'POST', token: bob.data.token, body: { content: 'Love this idea.' } });
    assert.equal(comment.status, 201);
    assert.equal((await request(path)).data.comments[0].author.username, 'bob');
    assert.equal((await request('/posts')).data.posts[0].commentCount, 1);
    assert.equal((await request(`/comments/${comment.data.comment.id}`, { method: 'DELETE', token: alice.data.token })).status, 403);
    assert.equal((await request(`/comments/${comment.data.comment.id}`, { method: 'DELETE', token: bob.data.token })).status, 204);
    await request(path, { method: 'POST', token: bob.data.token, body: { content: 'Cascade me.' } });
    await request(`/posts/${post.data.post.id}/like`, { method: 'PUT', token: bob.data.token });
    assert.equal((await request(`/posts/${post.data.post.id}`, { method: 'DELETE', token: alice.data.token })).status, 204);
    assert.equal((await db.select().from(comments)).length, 0);
    assert.equal((await db.select().from(likes)).length, 0);
    assert.equal((await request(path)).status, 404);
  });
  await t.test('stable cursor pagination with timestamp ties', async () => {
    const createdAt = '2026-01-01T00:00:00.000Z';
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, userId: alice.data.user.id, content: `Page ${i}`, createdAt, updatedAt: createdAt }));
    await db.insert(posts).values(rows);
    const first = (await request('/posts')).data;
    assert.equal(first.posts.length, 20);
    assert.ok(first.nextCursor);
    const second = (await request(`/posts?cursor=${first.nextCursor}`)).data;
    assert.equal(second.posts.length, 5);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.posts, ...second.posts].map(row => row.id)).size, 25);
    assert.equal((await request('/users/alice')).data.user.postCount, 25);
  });
  await t.test('CORS, input types, missing routes, revoked and expired sessions', async () => {
    assert.equal((await request('/posts', { origin: 'https://untrusted.example' })).status, 403);
    const allowed = await request('/posts', { origin: 'http://localhost:5173' });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await request('/posts', { method: 'POST', token: bob.data.token, body: [] })).status, 400);
    assert.equal((await request('/missing')).status, 404);
    assert.equal((await request('/auth/logout', { method: 'POST', token: bob.data.token })).status, 204);
    assert.equal((await request('/auth/me', { token: bob.data.token })).status, 401);
    await db.update(sessions).set({ expiresAt: 0 }).where(eq(sessions.tokenHash, hashToken(alice.data.token)));
    assert.equal((await request('/auth/me', { token: alice.data.token })).status, 401);
    assert.equal((await request('/posts', { token: 'bad-token' })).status, 401);
  });
  await t.test('persistent auth rate limit survives a second app instance', async () => {
    await db.delete(rateLimits);
    const second = createApp({ db, env: {} }).listen(0, '127.0.0.1');
    await once(second, 'listening');
    try {
      for (let i = 0; i < 10; i++) assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'bad' } })).status, 400);
      const response = await fetch(`http://127.0.0.1:${second.address().port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get('retry-after')) > 0);
      const [counter] = await db.select({ count: sql`max(${rateLimits.count})` }).from(rateLimits);
      assert.ok(counter.count >= 11);
    } finally { await new Promise(resolve => second.close(resolve)); }
  });
});

test('production requires remote Turso credentials and exact frontend origins', () => {
  assert.throws(() => connectDatabase({ NODE_ENV: 'production' }), /Production requires/);
  assert.throws(() => connectDatabase({ VERCEL: '1', TURSO_DATABASE_URL: 'file:bad.db' }), /Production requires/);
  assert.throws(() => createApp({ db: {}, env: { NODE_ENV: 'production' } }), /FRONTEND_URL/);
  assert.throws(() => createApp({ db: {}, env: { VERCEL: '1' } }), /FRONTEND_URL/);
  assert.throws(() => createApp({ db: {}, env: { FRONTEND_URL: 'https://example.com/path' } }), /exact HTTP/);
});
