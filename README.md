# Study Coach

Study Coach will turn study material into adaptive flashcards and practice questions using Gemini. It saves generated study sets and answer feedback in a Turso libSQL database.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your Gemini key as `GEMINI_API_KEY`.
5. Add your Turso database URL as `TURSO_DATABASE_URL` and auth token as `TURSO_AUTH_TOKEN`.
6. Run `npm run dev`.
7. Open `http://localhost:3000`.

The Gemini key belongs in the server-side `.env` file. Do not put it in `script.js`, `index.html`, or commit it to Git.

## Saved data

Study sets, concepts, flashcards, practice questions, weak areas, and answer evaluations are stored in Turso. Credentials stay in environment variables and must not be committed.

## Current setup check

Open `http://localhost:3000/api/health` to confirm the server is running. The response reports whether a Gemini key is configured without exposing the key.

## Planned flow

Study material -> Gemini concepts -> flashcards and questions -> student answers -> feedback -> weak areas -> personalized practice.