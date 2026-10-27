import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { and, or, eq, lt, desc, sql, count } from 'drizzle-orm';
import { users, sessions, posts, likes, comments, rateLimits } from './schema.js';
import { hashPassword, verifyPassword, hashToken, newToken } from './auth.js';

const DAY = 86400000;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (value, label, min, max) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    fail(400, `${label} must be ${min}–${max} characters.`);
  }
  return value.trim();
};
const passwordInput = value => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, 'Password must be 8–128 characters.');
  return value;
};
const emailInput = value => {
  const email = text(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
};
const idInput = value => {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) fail(400, 'Invalid ID.');
  return value;
};
const userFields = {
  id: users.id, name: users.name, username: users.username, bio: users.bio,
  website: users.website, createdAt: users.createdAt,
  postCount: sql`(select count(*) from posts as owned_posts where owned_posts.user_id = users.id)`.mapWith(Number),
};
const authorFields = { id: users.id, name: users.name, username: users.username };
const postFields = viewerId => ({
  id: posts.id, content: posts.content, createdAt: posts.createdAt, updatedAt: posts.updatedAt,
  author: authorFields,
  likeCount: sql`(select count(*) from ${likes} where ${likes.postId} = ${posts.id})`.mapWith(Number),
  commentCount: sql`(select count(*) from ${comments} where ${comments.postId} = ${posts.id})`.mapWith(Number),
  liked: sql`exists(select 1 from ${likes} where ${likes.postId} = ${posts.id} and ${likes.userId} = ${viewerId || ''})`.mapWith(Boolean),
});

export function createApp({ db, env = process.env }) {
  const app = express();
  app.disable('x-powered-by');
  if (env.VERCEL) app.set('trust proxy', 1);
  const origins = (env.FRONTEND_URL || ((env.NODE_ENV === 'production' || env.VERCEL) ? '' : 'http://localhost:5173')).split(',').map(origin => origin.trim()).filter(Boolean);
  if ((env.NODE_ENV === 'production' || env.VERCEL) && !origins.length) throw new Error('Production requires FRONTEND_URL.');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('FRONTEND_URL must contain exact HTTP(S) origins.');
  }
  app.use(helmet());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    res.vary('Origin');
    if (origin) res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((req, _res, next) => {
    if (req.body !== undefined && (req.body === null || Array.isArray(req.body))) fail(400, 'Expected a JSON object.');
    req.body ||= {};
    next();
  });

  async function limit(req, res, scope, identity, max, windowMs) {
    const now = Date.now();
    const key = hashToken(`${scope}:${identity}`);
    // ponytail: database-backed counters work across Vercel instances; add edge limits for large traffic.
    const [bucket] = await db.insert(rateLimits).values({ key, count: 1, resetsAt: now + windowMs }).onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetsAt} <= ${now} then 1 else ${rateLimits.count} + 1 end`,
        resetsAt: sql`case when ${rateLimits.resetsAt} <= ${now} then ${now + windowMs} else ${rateLimits.resetsAt} end`,
      },
    }).returning();
    if (Math.random() < 0.01) await db.delete(rateLimits).where(lt(rateLimits.resetsAt, now - DAY));
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000))));
      fail(429, 'Too many requests. Please try again later.');
    }
  }
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', async (req, res, next) => {
    await limit(req, res, 'api', req.ip, 180, 60000);
    if (req.headers.authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization);
      if (!match) fail(401, 'Session expired. Please sign in again.');
      const [session] = await db.select({ userId: sessions.userId }).from(sessions).where(and(
        eq(sessions.tokenHash, hashToken(match[1])), sql`${sessions.expiresAt} > ${Date.now()}`,
      ));
      if (!session) fail(401, 'Session expired. Please sign in again.');
      req.userId = session.userId;
      req.tokenHash = hashToken(match[1]);
    }
    next();
  });
  const requireAuth = async (req, res, next) => {
    if (!req.userId) fail(401, 'Please sign in to continue.');
    if (req.method !== 'GET') await limit(req, res, 'write', req.userId, 60, 60000);
    next();
  };
  const authLimit = async (req, res, next) => {
    await limit(req, res, 'auth', req.ip, 10, 15 * 60000);
    next();
  };
  const findUser = async id => (await db.select(userFields).from(users).where(eq(users.id, id)))[0];
  const findPost = async (id, viewerId) => (await db.select(postFields(viewerId)).from(posts).innerJoin(users, eq(posts.userId, users.id)).where(eq(posts.id, id)))[0];
  const assertPost = async id => {
    const [post] = await db.select({ id: posts.id, userId: posts.userId }).from(posts).where(eq(posts.id, idInput(id)));
    if (!post) fail(404, 'Post not found.');
    return post;
  };
  const issueSession = async userId => {
    const token = newToken();
    await db.batch([
      db.delete(sessions).where(lt(sessions.expiresAt, Date.now())),
      db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt: Date.now() + 7 * DAY }),
    ]);
    return { token, user: await findUser(userId) };
  };
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const name = text(req.body.name, 'Name', 1, 60);
    const username = text(req.body.username, 'Username', 3, 24).toLowerCase();
    if (!/^[a-z0-9_]+$/.test(username)) fail(400, 'Username may contain letters, numbers, and underscores.');
    const email = emailInput(req.body.email);
    const password = passwordInput(req.body.password);
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await db.insert(users).values({ id, name, username, email, passwordHash, createdAt: new Date().toISOString() });
    } catch (error) {
      if (String(error.cause?.message || error.message).includes('UNIQUE constraint')) fail(409, 'Email or username is already in use.');
      throw error;
    }
    res.status(201).json(await issueSession(id));
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const email = emailInput(req.body.email);
    const password = passwordInput(req.body.password);
    const [user] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email));
    if (!(await verifyPassword(password, user?.passwordHash))) fail(401, 'Email or password is incorrect.');
    res.json(await issueSession(user.id));
  });
  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await db.delete(sessions).where(eq(sessions.tokenHash, req.tokenHash));
    res.sendStatus(204);
  });
  app.get('/api/auth/me', requireAuth, async (req, res) => res.json({ user: await findUser(req.userId) }));
  app.patch('/api/me', requireAuth, async (req, res) => {
    const updates = {};
    if ('name' in req.body) updates.name = text(req.body.name, 'Name', 1, 60);
    if ('bio' in req.body) updates.bio = text(req.body.bio, 'Bio', 0, 180);
    if ('website' in req.body) {
      updates.website = text(req.body.website, 'Website', 0, 200);
      if (updates.website) {
        let url;
        try { url = new URL(updates.website); } catch { fail(400, 'Website must be a full HTTP(S) URL.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, 'Website must be a full HTTP(S) URL.');
      }
    }
    if (!Object.keys(updates).length) fail(400, 'Provide a name, bio, or website to update.');
    await db.update(users).set(updates).where(eq(users.id, req.userId));
    res.json({ user: await findUser(req.userId) });
  });
  app.get('/api/users/:username', async (req, res) => {
    const [user] = await db.select(userFields).from(users).where(eq(users.username, req.params.username.toLowerCase()));
    if (!user) fail(404, 'Profile not found.');
    // ponytail: profiles show the newest 50 posts; add profile pagination when needed.
    const userPosts = await db.select(postFields(req.userId)).from(posts).innerJoin(users, eq(posts.userId, users.id))
      .where(eq(posts.userId, user.id)).orderBy(desc(posts.createdAt), desc(posts.id)).limit(50);
    res.json({ user, posts: userPosts });
  });
  app.get('/api/posts', async (req, res) => {
    const filters = [];
    if (req.query.q !== undefined) {
      const query = text(req.query.q, 'Search', 0, 100).replace(/[\\%_]/g, '\\$&');
      filters.push(or(sql`${posts.content} like ${`%${query}%`} escape '\\'`, sql`${users.name} like ${`%${query}%`} escape '\\'`, sql`${users.username} like ${`%${query}%`} escape '\\'`));
    }
    if (req.query.cursor !== undefined) {
      let cursor;
      try {
        if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(req.query.cursor)) throw new Error();
        cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString());
        if (typeof cursor.createdAt !== 'string' || new Date(cursor.createdAt).toISOString() !== cursor.createdAt) throw new Error();
        idInput(cursor.id);
      } catch { fail(400, 'Invalid page cursor.'); }
      filters.push(or(lt(posts.createdAt, cursor.createdAt), and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id))));
    }
    const rows = await db.select(postFields(req.userId)).from(posts).innerJoin(users, eq(posts.userId, users.id))
      .where(and(...filters)).orderBy(desc(posts.createdAt), desc(posts.id)).limit(21);
    const page = rows.slice(0, 20);
    const last = page.at(-1);
    const nextCursor = rows.length > 20 ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
    res.json({ posts: page, nextCursor });
  });
  app.post('/api/posts', requireAuth, async (req, res) => {
    const content = text(req.body.content, 'Post', 1, 2000);
    const id = randomUUID();
    const now = new Date().toISOString();
    await db.insert(posts).values({ id, userId: req.userId, content, createdAt: now, updatedAt: now });
    res.status(201).json({ post: await findPost(id, req.userId) });
  });
  app.patch('/api/posts/:id', requireAuth, async (req, res) => {
    const post = await assertPost(req.params.id);
    if (post.userId !== req.userId) fail(403, 'Only the author can edit this post.');
    await db.update(posts).set({ content: text(req.body.content, 'Post', 1, 2000), updatedAt: new Date().toISOString() }).where(and(eq(posts.id, post.id), eq(posts.userId, req.userId)));
    res.json({ post: await findPost(post.id, req.userId) });
  });
  app.delete('/api/posts/:id', requireAuth, async (req, res) => {
    const post = await assertPost(req.params.id);
    if (post.userId !== req.userId) fail(403, 'Only the author can delete this post.');
    await db.delete(posts).where(and(eq(posts.id, post.id), eq(posts.userId, req.userId)));
    res.sendStatus(204);
  });
  for (const method of ['put', 'delete']) {
    app[method]('/api/posts/:id/like', requireAuth, async (req, res) => {
      const post = await assertPost(req.params.id);
      const liked = method === 'put';
      if (liked) await db.insert(likes).values({ postId: post.id, userId: req.userId }).onConflictDoNothing();
      else await db.delete(likes).where(and(eq(likes.postId, post.id), eq(likes.userId, req.userId)));
      const [total] = await db.select({ value: count() }).from(likes).where(eq(likes.postId, post.id));
      res.json({ liked, likeCount: total.value });
    });
  }
  const commentFields = { id: comments.id, content: comments.content, createdAt: comments.createdAt, author: authorFields };
  app.get('/api/posts/:id/comments', async (req, res) => {
    const post = await assertPost(req.params.id);
    // ponytail: keep the newest 200 comments; add comment pagination for longer conversations.
    const rows = await db.select(commentFields).from(comments).innerJoin(users, eq(comments.userId, users.id))
      .where(eq(comments.postId, post.id)).orderBy(desc(comments.createdAt), desc(comments.id)).limit(200);
    res.json({ comments: rows.reverse() });
  });
  app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
    const post = await assertPost(req.params.id);
    const id = randomUUID();
    await db.insert(comments).values({ id, postId: post.id, userId: req.userId, content: text(req.body.content, 'Comment', 1, 500), createdAt: new Date().toISOString() });
    const [comment] = await db.select(commentFields).from(comments).innerJoin(users, eq(comments.userId, users.id)).where(eq(comments.id, id));
    res.status(201).json({ comment });
  });
  app.delete('/api/comments/:id', requireAuth, async (req, res) => {
    const [comment] = await db.select({ id: comments.id, userId: comments.userId }).from(comments).where(eq(comments.id, idInput(req.params.id)));
    if (!comment) fail(404, 'Comment not found.');
    if (comment.userId !== req.userId) fail(403, 'Only the author can delete this comment.');
    await db.delete(comments).where(and(eq(comments.id, comment.id), eq(comments.userId, req.userId)));
    res.sendStatus(204);
  });
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('Request failed:', error.code || error.cause?.code || error.name);
    const message = error.type === 'entity.too.large' ? 'Request body is too large.' : error.type === 'entity.parse.failed' ? 'Invalid JSON body.' : status >= 500 ? 'Something went wrong. Please try again.' : error.message;
    res.status(status).json({ error: message });
  });
  return app;
}
