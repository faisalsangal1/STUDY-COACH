# Study Coach

Study Coach will turn study material into adaptive flashcards and practice questions using Gemini. It saves generated study sets and answer feedback in a local SQLite database.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Create a Gemini API key in Google AI Studio and add it to `.env` as `GEMINI_API_KEY`.
5. Run `npm run dev`.
6. Open `http://localhost:3000`.

The Gemini key belongs in the server-side `.env` file. Do not put it in `script.js`, `index.html`, or commit it to Git.

## Saved data

The first successful analysis creates `study-coach.sqlite` in the project folder. It stores study sets, concepts, flashcards, practice questions, weak areas, and answer evaluations. The database is local and is ignored by Git. Deleting that file resets saved study data.

## Current setup check

Open `http://localhost:3000/api/health` to confirm the server is running. The response reports whether a Gemini key is configured without exposing the key.

## Planned flow

Study material -> Gemini concepts -> flashcards and questions -> student answers -> feedback -> weak areas -> personalized practice.