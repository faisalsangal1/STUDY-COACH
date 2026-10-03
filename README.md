# Oryn AI Study Coach

Oryn AI is a personal study workspace that turns a student's own notes and syllabus topics into structured study tools, then keeps practice results and revision work together in one place.

## What It Does

- Organizes subjects and syllabus topics and tracks topic completion and practice accuracy.
- Generates structured revision notes, flashcards, practice questions, and timed exams from supplied study material or selected topics.
- Grades multiple-choice answers directly and uses AI to evaluate short answers with feedback.
- Records attempts and unresolved mistakes, shows performance on a dashboard, and builds revision plans from saved materials or observed performance.

## How AI Is Used

The server sends focused prompts to Groq's OpenAI-compatible chat-completions API, using the `openai/gpt-oss-120b` model. AI is used for the study tasks above, not as a general-purpose chat interface. Generated content is requested in structured JSON, checked by the API, and saved to the local workspace. Short-answer grading also uses AI; multiple-choice grading and performance-based revision prioritization are handled by the application.

Unlike a generic chatbot, Oryn AI organizes learning around source material, syllabus topics, saved notes, question attempts, and recurring mistakes. Its tools form a study loop: prepare material, practice, review feedback, and plan what to revisit.

## In Progress

A conversational chatbot and a curriculum-specific AKUEB experience are currently in development. For now, only their front-end previews are available in the app: the assistant preview does not provide chat responses, and AKUEB mode does not yet provide live syllabus-aligned study tools. The study generation and grading features described above are available separately.

## Technology

- **Frontend:** Vanilla HTML, CSS, and JavaScript; served by the app server.
- **Backend:** Node.js and Express, with a JSON REST API.
- **Data:** SQLite via `better-sqlite3`. The database is created automatically at `data/study-coach.sqlite` by default and stays on the machine running the server.
- **AI:** Groq API, called server-side. The API key is not sent to the browser.
- **Tests:** Node's built-in test runner; AI requests are mocked in the API tests.

This is a local, single-workspace app: it has no account system or remote application database. Anyone who can access the running app can use that workspace, so do not expose it publicly with personal study data.

## Requirements

- Node.js 20 or newer
- npm
- A Groq API key for AI-powered features

## Setup and Run

1. Open a terminal in the project folder and install dependencies:

   ```sh
   npm install
   ```

2. Create a `.env` file in the project root:

   ```dotenv
   GROQ_API_KEY=your_groq_api_key
   PORT=3000
   # Optional: database file path, relative to the project folder (or an absolute path)
   # DATABASE_PATH=data/study-coach.sqlite
   ```

   Keep `.env` private. It is excluded from version control. `PORT` and `DATABASE_PATH` are optional; the defaults are port `3000` and `data/study-coach.sqlite`.

3. Start the app:

   ```sh
   npm run dev
   ```

   For a regular start without the development file watcher, use `npm start`. Open the URL printed by the server, normally <http://127.0.0.1:3000>. If that port is occupied, the server tries subsequent ports and prints the chosen URL.

4. To check the AI connection, visit `http://127.0.0.1:3000/api/test-ai` using the actual port printed by the server. The basic health endpoint is `/api/health`.

Without `GROQ_API_KEY`, the app can start, but AI-powered generation and short-answer evaluation will not work.

## Tests

Run the API tests with:

```sh
npm test
```

The tests use a mocked Groq response and do not require a real API key or make paid model requests.

## Local Data

Study data is stored in the SQLite file at `DATABASE_PATH` (or the default under `data/`). The database is created on first run. The app's **Reset data** control deletes the saved workspace, so use it with care. The database and `.env` are ignored by Git; send the source project and configure a fresh API key on the machine where it will run.
