import express from 'express';
import { connectDatabase } from './db.js';
import { createApp } from './app.js';

// Vercel detects the Express import and default app export at this entrypoint.
const app = express();
const { db } = connectDatabase();
app.use(createApp({ db }));
export default app;
