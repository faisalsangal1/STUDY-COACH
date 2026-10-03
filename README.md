# Oryn AI Study Coach

Oryn AI is a personal study workspace for organizing syllabus topics, turning study material into learning tools, practicing, and planning revision. Subjects, generated content, results, and revision tasks are stored in a local SQLite database.

## Features

- Organize subjects and topics, and track topic completion and practice accuracy.
- Generate revision notes, flashcards, practice questions, and timed exams from pasted material, saved notes, or syllabus topics.
- Practice questions and exams; multiple-choice answers are graded locally and AI evaluates short answers.
- Review feedback and saved mistakes, view progress on a dashboard, and create revision plans.
- Add an optional Groq API key in the app, or configure one on the server.

Oryn AI is a study workflow, not a general-purpose chatbot. A conversational chatbot and a curriculum-specific AKUEB experience are in development; current previews do not provide live chat or syllabus-aligned AKUEB tools.

## How It Works

The browser interface uses HTML, CSS, and JavaScript and is served by a Node.js/Express server. The browser calls the server's JSON API, and the server stores workspace data in SQLite and calls Groq for AI-backed features.

By default, the database is `data/study-coach.sqlite` on the machine running the app. This is a local, single-workspace app with no accounts or access controls. When started normally, the server listens on `127.0.0.1` and tries subsequent ports if the configured port is busy.

## AI and API Keys

The AI provider is Groq's OpenAI-compatible chat-completions API, using the `openai/gpt-oss-120b` model. AI features include generating notes, flashcards, practice questions, and exams, and evaluating short answers. Multiple-choice grading and revision prioritization are handled by the app.

You can configure a key in either of these ways:

1. **In the app:** open **API key** in the sidebar, enter your Groq key, and choose **Save key in this browser**. The key is stored in that browser's local storage, not in the app's source code or SQLite database. The browser sends it in the `X-Groq-API-Key` request header for AI-backed API calls; the server forwards it to Groq. Use **Test connection** to check it, or **Remove key** to delete it from that browser.
2. **On the server:** set `GROQ_API_KEY` in the server environment or in a root `.env` file. The server uses this key when a request does not provide a browser key.

An `X-Groq-API-Key` request header takes precedence over the server-configured key for that request. The app does not save browser keys in SQLite. Anyone with access to the browser profile may be able to use a key saved there. Only enter a key when you trust the server receiving it; use HTTPS if you deploy the app beyond your own machine. Groq usage is subject to Groq's terms, pricing, and limits. Never commit or share a real API key.

AI-generated results are validated before they are saved. If the AI service is unavailable or returns invalid structured data, the API responds with an error instead of saving an incomplete result.

## Requirements

- Node.js 22 or newer, or Node.js 20 LTS (supported releases of the SQLite dependency)
- npm
- A Groq API key for AI-powered features
- Git, if cloning the project

## Install and Run

Clone the repository and enter the project folder:

```sh
git clone https://github.com/faisalsangal1/STUDY-COACH.git
cd STUDY-COACH
```

Install dependencies from the lockfile:

```sh
npm ci
```

On Windows, this project uses a prebuilt `better-sqlite3` binary, so a C++ compiler or Visual Studio Build Tools should not normally be needed. If installation reports a `node-gyp`/Visual Studio error, check that you are using a supported Node.js version above and retry `npm ci`.

Optionally create a `.env` file in the project root to configure a server-side API key, port, or database path:

```dotenv
GROQ_API_KEY=your_groq_api_key
PORT=3000
DATABASE_PATH=data/study-coach.sqlite
```

`GROQ_API_KEY` is optional if you will enter a key in the app. `PORT` defaults to `3000`. `DATABASE_PATH` defaults to `data/study-coach.sqlite` and may be a relative path (from the project folder) or an absolute path. Keep `.env` private; it is excluded from Git.

Start the app:

```sh
npm run dev
```

Or start without the development file watcher:

```sh
npm start
```

Open the URL printed in the terminal, normally <http://127.0.0.1:3000>. If that port is busy, the server tries following ports and prints the one it uses.

## HTTP API

All routes below are prefixed with `/api`. The API accepts and returns JSON for requests and responses with bodies. Send `Content-Type: application/json` for JSON request bodies. The server limits JSON request bodies to 1 MB. Path IDs are positive integers.

### Health and AI connection

| Method and route | Description |
| --- | --- |
| `GET /api/health` | Returns `{ "ok": true }` when the app server is running. Does not check Groq. |
| `GET /api/test-ai` | Sends a small test request to Groq and returns its response. Accepts `X-Groq-API-Key`; otherwise uses `GROQ_API_KEY`. |

### Subjects and syllabus topics

| Method and route | Description |
| --- | --- |
| `GET /api/subjects` | Lists subjects with their topics and topic performance. |
| `POST /api/subjects` | Creates a subject. Body: `{ "name": "Physics" }`. |
| `PUT /api/subjects/:id` | Renames a subject. Body: `{ "name": "Physics" }`. |
| `DELETE /api/subjects/:id` | Deletes a subject. |
| `GET /api/subjects/:subjectId/topics` | Lists a subject's topics. |
| `POST /api/topics` | Creates a topic. Body: `{ "subjectId": 1, "name": "Motion" }`. |
| `PUT /api/topics/:id` | Renames a topic. Body: `{ "name": "Motion" }`. |
| `PATCH /api/topics/:id` | Updates status to `not_started`, `in_progress`, or `completed`. |
| `DELETE /api/topics/:id` | Deletes a topic. |

### Study material, notes, and flashcards

| Method and route | Description |
| --- | --- |
| `GET /api/materials` | Lists saved source materials. |
| `POST /api/notes/generate` | Generates and saves notes and their source material. Body: `{ "title": "Motion", "material": "Study text...", "topicId": 1 }`; `title` and `topicId` are optional. |
| `GET /api/notes` | Lists saved notes. |
| `GET /api/notes/:id` | Gets a note. |
| `DELETE /api/notes/:id` | Deletes a note and its associated study material. |
| `POST /api/flashcards/generate` | Generates and saves flashcards from a note or material. Body: `{ "noteId": 1, "count": 10 }` or `{ "materialId": 1, "count": 10 }`; count defaults to 10 and must be 2–30. |
| `GET /api/flashcards` | Lists saved flashcard sets. |
| `GET /api/flashcards/:id` | Gets a flashcard set. |
| `DELETE /api/flashcards/:id` | Deletes a flashcard set. |

### Practice questions and grading

| Method and route | Description |
| --- | --- |
| `POST /api/questions/generate` | Generates and saves questions from a note or material. Body: `{ "noteId": 1, "count": 8 }` or `{ "materialId": 1, "count": 8 }`; count defaults to 8 and must be 1–20. |
| `GET /api/materials/:materialId/questions` | Lists practice questions for a material, without correct answers or explanations. |
| `POST /api/questions/:id/answer` | Grades and records one answer. Body: `{ "answer": "..." }`. |
| `POST /api/questions/submit` | Grades and records 1–20 answers together. Body: `{ "answers": [{ "questionId": 1, "answer": "..." }] }`. |

Multiple-choice answers are graded by the app. Short-answer grading uses Groq. Incorrect answers may be recorded in the mistake bank.

### Exams

| Method and route | Description |
| --- | --- |
| `POST /api/exams/generate` | Generates and saves an exam. Provide saved `materialId`, `topicIds`, or `topicNames`; optional fields include `subjectId`, `title`, `difficulty`, `count` (1–25, default 10), and `durationMinutes` (5–240, default 30). |
| `GET /api/exams` | Lists saved exams. |
| `GET /api/exams/:id` | Gets an exam and its questions. |
| `POST /api/exams/:id/submit` | Submits answers. Body: `{ "answers": [{ "questionId": 1, "answer": "..." }] }`. Returns the score and topic results. |
| `DELETE /api/exams/:id` | Deletes an exam. |

Exam multiple-choice answers are graded locally; short answers are evaluated by Groq. An exam can only be submitted once.

### Dashboard, revision, mistakes, and workspace

| Method and route | Description |
| --- | --- |
| `GET /api/dashboard` | Returns workspace counts, overall accuracy, and topic performance. |
| `GET /api/revision` | Lists revision tasks. |
| `POST /api/revision/generate` | Creates revision tasks from saved `noteIds`, `examIds`, and/or `topicNames`; without those selections, prioritizes topics using recorded performance. |
| `PATCH /api/revision/:id/complete` | Marks a task complete. |
| `DELETE /api/revision/:id` | Deletes a revision task. |
| `GET /api/mistakes` | Lists mistakes. Optional query filters: `topicId`, `subjectId`, and `resolved=true|false`. |
| `PATCH /api/mistakes/:id` | Marks a mistake resolved. Body: `{ "resolved": true }`. |
| `DELETE /api/mistakes/:id` | Deletes a mistake. |
| `DELETE /api/workspace` | Permanently clears the local workspace data. |

Revision planning uses app data and does not require an AI API key.

### Calling an AI-backed endpoint

The browser automatically adds the saved browser key to supported AI requests. A direct API client can pass the key as a raw value in `X-Groq-API-Key`:

```sh
curl -X POST http://127.0.0.1:3000/api/notes/generate \
  -H "Content-Type: application/json" \
  -H "X-Groq-API-Key: your_groq_api_key" \
  -d "{\"title\":\"Motion\",\"material\":\"Velocity is the rate of change of displacement.\"}"
```

AI-backed routes are `POST /api/notes/generate`, `POST /api/flashcards/generate`, `POST /api/questions/generate`, `POST /api/questions/:id/answer`, `POST /api/questions/submit`, `POST /api/exams/generate`, `POST /api/exams/:id/submit`, and `GET /api/test-ai`. If neither the request header nor server environment contains a key, those AI operations cannot complete. Common API errors include `400` for invalid input, `404` for missing records, `409` for conflicting operations, `413` for an oversized JSON request, `502` for invalid AI output, and `503` when an AI-backed operation cannot reach the provider. The connection-test route returns `500` when its check fails; unexpected API errors return `500`.

## Tests

Run the test suite:

```sh
npm test
```

Tests use mocked Groq responses. They do not require a real API key or make paid model requests.

## Data, Privacy, and Hosting

The local SQLite database and `.env` are excluded from Git. A fresh database is created on first run; existing study data and saved browser API keys are not included in the repository. The **Reset data** control and `DELETE /api/workspace` permanently clear saved workspace data.

GitHub stores this project's source code; it does not run the app. Oryn AI is an Express backend with a local SQLite database and is not a static GitHub Pages app. It is intended for local use: there is no account system or access control, and the normal server binds to loopback. Do not expose it publicly with personal study data or API keys without first adding appropriate authentication, access controls, HTTPS, and persistent database storage.
