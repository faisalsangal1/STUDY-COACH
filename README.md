# Oryn AI Study Coach

Oryn AI is a personal study workspace that turns study material and syllabus topics into structured learning tools. It keeps practice results, mistakes, and revision work together so students can see what to study next.

## Core Features

- Organize subjects and syllabus topics, and track topic completion and practice accuracy.
- Generate revision notes, flashcards, practice questions, and timed exams from pasted study material, saved materials, or selected topics.
- Practice questions and exams, get feedback, and review saved attempts and unresolved mistakes.
- Grade multiple-choice answers directly in the app and use AI to assess short answers.
- View progress on a dashboard and create revision plans based on saved materials and performance.
- Paste class notes or passages into the study tools. The revision planner also accepts syllabus files in text or Markdown format.

## How the App Works

The browser interface is built with HTML, CSS, and JavaScript and is served by the Node.js/Express server. The browser sends requests to the server's JSON API. The server handles study workflows, calls the AI service for supported tasks, and saves subjects, study materials, generated content, attempts, and revision data to a local SQLite database.

By default, the database is created at `data/study-coach.sqlite` on the machine running the app. It is not a shared online database. This is a local, single-workspace app: it has no account system, and anyone who can access a running instance can use that workspace.

## How AI Is Used

For AI-powered study tasks, the server sends focused prompts to Groq's OpenAI-compatible chat-completions API using the `openai/gpt-oss-120b` model. The API key stays on the server and is not sent to the browser.

AI helps generate structured revision notes, flashcards, practice questions, and exams from the material or topics provided. The app requests structured JSON, validates the response, and saves valid results to the local workspace. AI also evaluates short answers and provides feedback. Multiple-choice grading and performance-based revision prioritization are handled by the app itself.

Oryn AI is designed around a study loop—prepare material, practice, review feedback and mistakes, then plan what to revisit—not as a general-purpose chatbot.

## In Progress

A conversational chatbot and a curriculum-specific AKUEB experience are in development. Their current front-end previews do not provide chat responses or live syllabus-aligned AKUEB study tools. The study generation and grading features described above are available separately.

## Technology

- **Frontend:** Vanilla HTML, CSS, and JavaScript.
- **Backend:** Node.js and Express, with a JSON REST API.
- **Data:** SQLite via `better-sqlite3`.
- **AI:** Groq API, called server-side.
- **Tests:** Node's built-in test runner; AI requests are mocked in the API tests.

## Requirements

- Node.js 20 or newer
- npm
- A Groq API key for AI-powered features
- Git, if cloning the project from GitHub

## Get the Project from GitHub

Clone the repository, then change into the project folder:

```sh
git clone https://github.com/faisalsangal1/STUDY-COACH.git
cd STUDY-COACH
```

You can also use GitHub's **Code → Download ZIP** option and extract the archive. If you download the ZIP, open a terminal in the extracted `STUDY-COACH` folder before continuing.

## Install and Run

1. Install the project's dependencies:

   ```sh
   npm install
   ```

2. To use AI features, either enter your Groq API key in the app's **API key** page after it starts, or create a `.env` file in the project root:

   ```dotenv
   GROQ_API_KEY=your_groq_api_key
   PORT=3000
   ```

   Get an API key from Groq and replace `your_groq_api_key` with that key. Keep `.env` private: it is excluded from Git, and you should never commit or share your real API key. `PORT` is optional and defaults to `3000`. You can also optionally set `DATABASE_PATH` to choose a database file path (relative to the project folder or an absolute path); otherwise the app uses `data/study-coach.sqlite`.

   Alternatively, start the app and open **API key** in the sidebar. A key entered there is saved in that browser's local storage, not in the source code or SQLite database. The browser sends it to the app server only for AI requests; the server forwards it to Groq. Anyone with access to that browser profile may be able to use the saved key, so remove it on shared devices. If you deploy the app, use HTTPS and only enter a key on a server you trust. Groq usage may be subject to its own pricing and limits.

3. Start the app in development mode:

   ```sh
   npm run dev
   ```

   Or start it without the development file watcher:

   ```sh
   npm start
   ```

4. Open the local URL printed in the terminal, normally <http://127.0.0.1:3000>. If that port is busy, the server tries the following ports and prints the URL it uses.

The app can start without `GROQ_API_KEY`; add a key in the sidebar to enable AI-powered generation and short-answer evaluation. To check a server-configured AI connection, open `http://127.0.0.1:3000/api/test-ai` using the actual port printed by the server. Use **Test connection** on the API key page to test a browser-saved key. The basic health endpoint is `/api/health`.

## Run Tests

```sh
npm test
```

The tests use mocked Groq responses; they do not require a real API key or make paid model requests.

## Data and Hosting Notes

GitHub stores the project's source code; it does not run this app. The project is an Express backend with a local SQLite database, so it cannot be hosted as a static GitHub Pages site. The local database and `.env` are excluded from Git. After cloning, the app creates a fresh database on first run; existing study data is not included in the repository.

This app is intended for local use. Do not expose it publicly with personal study data: it currently has no accounts or access controls. Public hosting would require a suitable server host and additional work to secure access and provide persistent database storage.

The app's **Reset data** control deletes the saved local workspace, so use it with care.
