import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { eq, count, sql } from 'drizzle-orm';
import { connectDatabase } from '../src/db.js';
import { migrateDatabase } from '../src/migrate.js';
import { createApp } from '../src/create-app.js';
import { posts, postImages } from '../src/schema.js';
import { MAX_IMAGE_BYTES } from '../src/image.js';
// Valid 2×2 solid-color test images; static bytes need no imaging dependency at runtime.
const images = {
  png: { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGN0nJjJwMDAxAAGAA7GAT9oT6RxAAAAAElFTkSuQmCC' },
  jpeg: { mime: 'image/jpeg', data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCpRRRWJ88f/9k=' },
  webp: { mime: 'image/webp', data: 'UklGRjIAAABXRUJQVlA4ICYAAABwAQCdASoCAAIAAUAmJaACdAF1AAD+4uBIw0a//IMf6Gv8Fd2AAA==' },
  webpAlpha: { mime: 'image/webp', data: 'UklGRlIAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggJgAAAHABAJ0BKgIAAgABQCYloAJ0AXUAAP7i4EjDRr/8gx/oa/wV3YAA' }
};


test('image posts: bounded upload, binary persistence, public delivery, and deletion', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-images-'));
  const env = { TURSO_DATABASE_URL: `file:${join(dir, 'test.db')}` };
  const { client, db } = connectDatabase(env);
  await migrateDatabase(db);
  const server = createApp({ db, env: { FRONTEND_URL: 'http://localhost:5173' } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); client.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { method = 'GET', token, body, origin } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }), ...(origin && { Origin: origin }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  const register = async username => {
    const response = await request('/auth/register', { method: 'POST', body: { name: username, username, email: `${username}@example.com`, password: 'image-test-password' } });
    assert.equal(response.status, 201);
    return response.data;
  };
  const alice = await register('image_alice'), bob = await register('image_bob');
  let withCaption, imageOnly, plain;
  const create = (body, token = alice.token) => request('/posts', { method: 'POST', token, body });
  const storedCount = async () => (await db.select({ value: count() }).from(posts))[0].value;

  await t.test('caption plus image returns only a nullable URL, stores a BLOB, and preserves plain posts', async () => {
    const response = await create({ content: 'A small moment in green.', image: images.png });
    assert.equal(response.status, 201);
    withCaption = response.data.post;
    assert.equal(withCaption.imageUrl, `/api/posts/${withCaption.id}/image`);
    assert.equal(withCaption.content, 'A small moment in green.');
    const [stored] = await db.select({ bytes: postImages.bytes, storageType: sql`typeof(${postImages.bytes})` }).from(postImages).where(eq(postImages.postId, withCaption.id));
    assert.equal(stored.storageType, 'blob');
    assert.ok(Buffer.isBuffer(stored.bytes));
    assert.deepEqual(stored.bytes, Buffer.from(images.png.data, 'base64'));
    plain = (await create({ content: 'Still a plain text post.' })).data.post;
    assert.equal(plain.imageUrl, null);
    const feed = (await request('/posts')).data.posts;
    const profile = (await request('/users/image_alice')).data.posts;
    for (const post of [...feed, ...profile]) {
      assert.equal('bytes' in post || 'image' in post || 'data' in post || 'mime' in post, false);
      assert.equal(JSON.stringify(post).includes(images.png.data), false);
    }
    assert.equal(feed.find(post => post.id === withCaption.id).imageUrl, withCaption.imageUrl);
  });
  await t.test('image-only creation and empty caption edits retain the same attachment', async () => {
    const response = await create({ content: '', image: images.png });
    assert.equal(response.status, 201);
    imageOnly = response.data.post;
    assert.equal(imageOnly.content, '');
    let edited = await request(`/posts/${imageOnly.id}`, { method: 'PATCH', token: alice.token, body: { content: 'Now with a caption.' } });
    assert.equal(edited.data.post.imageUrl, imageOnly.imageUrl);
    edited = await request(`/posts/${imageOnly.id}`, { method: 'PATCH', token: alice.token, body: { content: '' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.post.content, '');
    assert.equal(edited.data.post.imageUrl, imageOnly.imageUrl);
    assert.equal((await request(`/posts/${plain.id}`, { method: 'PATCH', token: alice.token, body: { content: '' } })).status, 400);
    assert.equal((await create({ content: '' })).status, 400);
  });
  await t.test('public raw image delivery is byte-exact with cross-origin and no-sniff headers', async () => {
    const response = await fetch(`${base}/posts/${withCaption.id}/image`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(images.png.data, 'base64'));
    assert.equal((await request(`/posts/${withCaption.id}/image`, { origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await request(`/posts/${plain.id}/image`)).status, 404);
  });
  await t.test('a fresh database connection and app return the same durable image bytes', async () => {
    const other = connectDatabase(env);
    const second = createApp({ db: other.db, env: {} }).listen(0, '127.0.0.1');
    await once(second, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${second.address().port}${withCaption.imageUrl}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(images.png.data, 'base64'));
    } finally { await new Promise(resolve => second.close(resolve)); other.client.close(); }
  });
  await t.test('real JPEG and WebP files pass format validation and retain their MIME types', async () => {
    for (const image of [images.jpeg, images.webp, images.webpAlpha]) {
      const response = await create({ content: '', image });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      const raw = await fetch(`${base}/posts/${response.data.post.id}/image`);
      assert.equal(raw.headers.get('content-type'), image.mime);
      assert.deepEqual(Buffer.from(await raw.arrayBuffer()), Buffer.from(image.data, 'base64'));
    }
  });
  await t.test('authentication happens before large JSON parsing; other routes keep the 16 KiB limit', async () => {
    assert.equal((await request('/posts', { method: 'POST', body: { content: '', image: images.png } })).status, 401);
    const tooLargeBody = { content: 'x'.repeat(1600000) };
    assert.equal((await request('/posts', { method: 'POST', body: tooLargeBody })).status, 401);
    assert.equal((await create(tooLargeBody)).status, 413);
    const unrelated = await request(`/posts/${plain.id}`, { method: 'PATCH', token: alice.token, body: { content: 'x'.repeat(17000) } });
    assert.equal(unrelated.status, 413);
  });
  await t.test('malformed base64, unsupported MIME, mismatches, broken containers, and oversized images are rejected before storage', async () => {
    const before = await storedCount();
    const brokenPng = Buffer.from(images.png.data, 'base64'); brokenPng[30] ^= 1;
    const brokenWebp = Buffer.from(images.webp.data, 'base64'); brokenWebp.writeUInt32LE(4, 4);
    const jpegWithoutEnd = Buffer.from(images.jpeg.data, 'base64').subarray(0, -2);
    for (const image of [
      null, [], { mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') },
      { mime: 'image/png', data: 123 }, { mime: 'image/png', data: '' },
      { mime: 'image/png', data: `${images.png.data}\n` }, { mime: 'image/png', data: 'data:image/png;base64,AAAA' },
      { mime: 'image/png', data: 'AB==' }, { mime: 'image/png', data: Buffer.from('<html>not an image</html>').toString('base64') },
      { mime: 'image/jpeg', data: images.png.data }, { mime: 'image/png', data: images.jpeg.data },
      { mime: 'image/png', data: brokenPng.toString('base64') }, { mime: 'image/webp', data: brokenWebp.toString('base64') },
      { mime: 'image/jpeg', data: jpegWithoutEnd.toString('base64') },
    ]) assert.equal((await create({ content: '', image })).status, 400);
    const tooLarge = await create({ content: '', image: { mime: 'image/png', data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') } });
    assert.equal(tooLarge.status, 413);
    assert.match(tooLarge.data.error, /1 MiB/);
    assert.equal((await create({ content: 'x'.repeat(2001), image: images.png })).status, 400);
    assert.equal(await storedCount(), before);
  });
  await t.test('post plus image inserts roll back together when the image write fails', async () => {
    const before = await storedCount();
    await client.execute("CREATE TRIGGER reject_test_image BEFORE INSERT ON post_images BEGIN SELECT RAISE(ABORT, 'test image failure'); END;");
    try { assert.equal((await create({ content: 'Must roll back.', image: images.png })).status, 500); }
    finally { await client.execute('DROP TRIGGER reject_test_image;'); }
    assert.equal(await storedCount(), before);
  });
  await t.test('ownership checks protect caption edits and post deletion; deletion cascades the attachment', async () => {
    assert.equal((await request(`/posts/${withCaption.id}`, { method: 'PATCH', token: bob.token, body: { content: 'Hijack.' } })).status, 403);
    assert.equal((await request(`/posts/${withCaption.id}`, { method: 'DELETE', token: bob.token })).status, 403);
    assert.equal((await request(`/posts/${withCaption.id}`, { method: 'DELETE', token: alice.token })).status, 204);
    assert.equal((await db.select().from(postImages).where(eq(postImages.postId, withCaption.id))).length, 0);
    assert.equal((await request(`/posts/${withCaption.id}/image`)).status, 404);
    assert.equal((await fetch(`${base}/posts/${imageOnly.id}/image`)).status, 200);
  });
});
