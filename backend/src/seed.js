import { randomBytes, randomUUID } from 'node:crypto';
import { connectDatabase } from './db.js';
import { users, posts } from './schema.js';
import { hashPassword } from './auth.js';

// ponytail: an explicit editorial demo seed; there is no automatic production seed or shared login password.
const people = [
  { name: 'Maya Chen', username: 'mayachen', bio: 'Designing things that make everyday life a little better.', messages: [
    'A reminder to make something just for the joy of it. No brief, no deadline. What are you making this week?',
    'The best part of a side project is the people you meet along the way. Keep sharing your work, even when it feels unfinished.',
  ] },
  { name: 'Alex Rivera', username: 'alexrivera', bio: 'Developer, coffee enthusiast, and curious human.', messages: [
    'Finally shipped my little weekend project. A few rough edges, a lot of learning, and that very good feeling of clicking publish.',
    'Small progress still counts. Today I fixed one stubborn bug and went for a long walk. Calling that a good day.',
  ] },
  { name: 'Nina Park', username: 'ninapark', bio: 'Collecting stories, good light, and quiet moments.', messages: [
    'Took the long way home and found a tiny bookshop I had never noticed before. A good reminder to look up more often.',
    'What is one thing you learned recently that changed how you see the world? I am collecting little sparks of curiosity today.',
  ] },
];
const { client, db } = connectDatabase();
let added = 0;
try {
  for (const [index, person] of people.entries()) {
    const id = randomUUID();
    const createdAt = new Date(Date.now() - 7 * 86400000).toISOString();
    const inserted = await db.insert(users).values({ id, name: person.name, username: person.username, bio: person.bio, email: `${person.username}@example.invalid`, passwordHash: await hashPassword(randomBytes(32).toString('base64url')), createdAt }).onConflictDoNothing().returning({ id: users.id });
    if (!inserted.length) continue;
    await db.insert(posts).values(person.messages.map((content, messageIndex) => {
      const timestamp = new Date(Date.now() - (index * 2 + messageIndex + 1) * 3600000).toISOString();
      return { id: randomUUID(), userId: id, content, createdAt: timestamp, updatedAt: timestamp };
    }));
    added++;
  }
  console.log(`Added ${added} demo profiles. Seeded profiles have no shared login credentials.`);
} finally { client.close(); }
