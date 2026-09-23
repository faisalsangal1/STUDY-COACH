const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.warn('Turso database credentials are not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
}

const database = createClient({ url, authToken });
let schemaPromise;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = database.batch([
      { sql: `CREATE TABLE IF NOT EXISTS study_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', source_name TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` },
      { sql: `CREATE TABLE IF NOT EXISTS concepts (id INTEGER PRIMARY KEY AUTOINCREMENT, study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', importance TEXT NOT NULL DEFAULT 'medium')` },
      { sql: `CREATE TABLE IF NOT EXISTS flashcards (id INTEGER PRIMARY KEY AUTOINCREMENT, study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE, front TEXT NOT NULL, back TEXT NOT NULL DEFAULT '')` },
      { sql: `CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE, question TEXT NOT NULL, answer TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'medium', options_json TEXT NOT NULL DEFAULT '[]')` },
      { sql: `CREATE TABLE IF NOT EXISTS weak_areas (id INTEGER PRIMARY KEY AUTOINCREMENT, study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE, topic TEXT NOT NULL)` },
      { sql: `CREATE TABLE IF NOT EXISTS evaluations (id INTEGER PRIMARY KEY AUTOINCREMENT, study_set_id INTEGER NOT NULL REFERENCES study_sets(id) ON DELETE CASCADE, question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE, student_answer TEXT NOT NULL, correct INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, feedback TEXT NOT NULL DEFAULT '', correction TEXT NOT NULL DEFAULT '', next_step TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` },
    ]).then(() => database.execute(`ALTER TABLE questions ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'`)).catch(async (error) => {
      if (!error.message.includes('duplicate column name')) throw error;
    });
  }
  return schemaPromise;
}

async function saveStudySet(studySet, sourceName) {
  await ensureSchema();
  const transaction = await database.transaction('write');
  try {
    const setResult = await transaction.execute({ sql: 'INSERT INTO study_sets (title, summary, source_name) VALUES (?, ?, ?)', args: [studySet.title || 'Untitled study set', studySet.summary || '', sourceName || null] });
    const studySetId = Number(setResult.lastInsertRowid);
    for (const concept of studySet.concepts || []) await transaction.execute({ sql: 'INSERT INTO concepts (study_set_id, name, description, importance) VALUES (?, ?, ?, ?)', args: [studySetId, concept.name || 'Key concept', concept.description || '', concept.importance || 'medium'] });
    for (const card of studySet.flashcards || []) await transaction.execute({ sql: 'INSERT INTO flashcards (study_set_id, front, back) VALUES (?, ?, ?)', args: [studySetId, card.front || 'Review this concept', card.back || card.description || ''] });
    for (const question of studySet.questions || []) {
      const options = Array.isArray(question.options) ? question.options.slice(0, 4) : [];
      const answer = question.answer || options[Number(question.correctOptionIndex)] || '';
      await transaction.execute({ sql: 'INSERT INTO questions (study_set_id, question, answer, explanation, difficulty, options_json) VALUES (?, ?, ?, ?, ?, ?)', args: [studySetId, question.question || 'Review this question', answer, question.explanation || '', question.difficulty || 'medium', JSON.stringify(options)] });
    }
    for (const area of studySet.weakAreas || []) await transaction.execute({ sql: 'INSERT INTO weak_areas (study_set_id, topic) VALUES (?, ?)', args: [studySetId, typeof area === 'string' ? area : area.topic || area.name || area.description || 'Review this topic'] });
    await transaction.commit();
    return studySetId;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function getStudySet(id) {
  await ensureSchema();
  const result = await database.execute({ sql: 'SELECT id, title, summary, source_name AS sourceName, created_at AS createdAt FROM study_sets WHERE id = ?', args: [id] });
  const row = result.rows[0];
  if (!row) return null;
  const [concepts, flashcards, questions, weakAreas] = await Promise.all([
    database.execute({ sql: 'SELECT name, description, importance FROM concepts WHERE study_set_id = ? ORDER BY id', args: [id] }),
    database.execute({ sql: 'SELECT id, front, back FROM flashcards WHERE study_set_id = ? ORDER BY id', args: [id] }),
    database.execute({ sql: 'SELECT id, question, answer, explanation, difficulty, options_json AS optionsJson FROM questions WHERE study_set_id = ? ORDER BY id', args: [id] }),
    database.execute({ sql: 'SELECT topic FROM weak_areas WHERE study_set_id = ? ORDER BY id', args: [id] }),
  ]);
  return {
    ...row,
    concepts: concepts.rows,
    flashcards: flashcards.rows,
    questions: questions.rows.map((question) => ({ ...question, options: JSON.parse(question.optionsJson || '[]'), optionsJson: undefined })),
    weakAreas: weakAreas.rows.map((area) => area.topic),
  };
}

async function getRecentStudySets() {
  await ensureSchema();
  const result = await database.execute(`SELECT id, title, summary, source_name AS sourceName, created_at AS createdAt, (SELECT COUNT(*) FROM flashcards WHERE study_set_id = study_sets.id) AS flashcardCount, (SELECT COUNT(*) FROM questions WHERE study_set_id = study_sets.id) AS questionCount FROM study_sets ORDER BY created_at DESC, id DESC`);
  return result.rows;
}

async function deleteStudySet(id) {
  await ensureSchema();
  const result = await database.execute({ sql: 'DELETE FROM study_sets WHERE id = ?', args: [id] });
  return Number(result.rowsAffected) > 0;
}

async function saveEvaluation(studySetId, questionId, evaluation, studentAnswer) {
  await ensureSchema();
  await database.execute({ sql: `INSERT INTO evaluations (study_set_id, question_id, student_answer, correct, score, feedback, correction, next_step) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [studySetId, questionId, studentAnswer, evaluation.correct ? 1 : 0, evaluation.score || 0, evaluation.feedback || '', evaluation.correction || '', evaluation.nextStep || ''] });
}

module.exports = { deleteStudySet, getRecentStudySets, getStudySet, saveEvaluation, saveStudySet };
