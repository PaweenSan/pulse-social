import { sqliteTable, text, integer, index, primaryKey, blob } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  bio: text('bio').notNull().default(''),
  website: text('website').notNull().default(''),
  createdAt: text('created_at').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('sessions_expiry_idx').on(table.expiresAt)]);
export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('posts_feed_idx').on(table.createdAt, table.id), index('posts_user_idx').on(table.userId)]);
// ponytail: one image up to 1 MiB per post in Turso; move to object storage when media volume grows.
export const postImages = sqliteTable('post_images', {
  postId: text('post_id').primaryKey().references(() => posts.id, { onDelete: 'cascade' }),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  mime: text('mime').notNull(),
});
export const likes = sqliteTable('likes', {
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, table => [primaryKey({ columns: [table.postId, table.userId] })]);
export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('comments_post_idx').on(table.postId, table.createdAt)]);
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetsAt: integer('resets_at').notNull(),
}, table => [index('rate_limits_expiry_idx').on(table.resetsAt)]);
